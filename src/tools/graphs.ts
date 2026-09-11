/** Working with named graphs as whole objects, via the Graph Store Protocol. */

import type { ToolDef } from './types.js';
import { requireString } from './types.js';
import { readText, writeText, mediaTypeFor, isQuadFormat } from '../files.js';

export const listGraphs: ToolDef = {
  name: 'list_graphs',
  writes: false,
  description: `List the named graphs in a dataset, with a triple count for each.

Only graphs holding at least one triple appear, and on TDB2 that is the whole
story: an empty graph is indistinguishable from one that was never created. If a
graph you just made is missing, it has no triples yet.

The default graph is reported separately, because a query without a GRAPH clause
reads that one -- and on a store without a union default graph it is often empty
while the named graphs are full.`,
  inputSchema: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
    },
  },
  async run(args, ctx) {
    const rows = await ctx.client.queryJson(
      'SELECT ?g (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g ORDER BY DESC(?n)',
      { dataset: args.dataset, limit: 0 },
    );
    const defaultCount = await ctx.client.count(
      'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }', args.dataset,
    );

    const graphs = (rows.results?.bindings ?? []).map((b) => ({
      graph: b.g?.value ?? '?',
      triples: Number(b.n?.value ?? 0),
    }));

    if (graphs.length === 0 && defaultCount === 0) {
      return `Dataset "${args.dataset || ctx.config.dataset}" is empty.`;
    }

    const width = Math.max(...graphs.map((g) => String(g.triples).length), 7);
    const lines = graphs.map((g) => `  ${String(g.triples).padStart(width)}  ${g.graph}`);
    const total = graphs.reduce((sum, g) => sum + g.triples, 0);

    return [
      `Named graphs in "${args.dataset || ctx.config.dataset}":`,
      ...lines,
      `  ${'-'.repeat(width)}`,
      `  ${String(total).padStart(width)}  in ${graphs.length} named graph(s)`,
      '',
      `Default graph: ${defaultCount.toLocaleString('en')} triple(s)` +
        (defaultCount === 0 && total > 0
          ? ' -- queries without a GRAPH clause will find nothing here.'
          : ''),
    ].join('\n');
  },
};

export const readGraph: ToolDef = {
  name: 'read_graph',
  writes: false,
  description: `Fetch one named graph whole, as Turtle.

One HTTP request, and it never touches the query parser -- the right way to read
a graph you intend to inspect or copy. A CONSTRUCT returns the same triples but
has to be parsed as a query first.

A 404 here means the graph holds no triples. That is not an error about the
endpoint.

Graphs get large quickly; pass out_file for anything beyond a few hundred
triples.`,
  inputSchema: {
    type: 'object',
    properties: {
      graph: { type: 'string', description: 'Graph IRI. Omit for the default graph.' },
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
      format: {
        type: 'string',
        description: 'Media type to request: text/turtle (default), application/n-triples, application/rdf+xml, application/ld+json.',
      },
      out_file: { type: 'string', description: 'Write to this path in the sandbox instead of returning the content.' },
    },
  },
  async run(args, ctx) {
    const body = await ctx.client.readGraph(args.graph, {
      dataset: args.dataset,
      accept: args.format,
    });
    if (args.out_file) {
      const written = writeText(ctx.config, args.out_file, body);
      return `Wrote ${written.bytes.toLocaleString('en')} bytes to ${written.path}.`;
    }
    return ctx.cap(body, 'graph');
  },
};

export const writeGraph: ToolDef = {
  name: 'write_graph',
  writes: true,
  description: `Replace or extend one named graph with RDF you supply.

mode "replace" (the default) makes the graph exactly what you send: whatever was
in it is gone. mode "merge" adds to what is there.

Replacing per graph is how a versioned schema is kept in sync -- one graph per
module, so that updating one cannot wipe another.

Give the RDF either inline (content) or from a file (file). Prefer the file for
anything beyond a handful of triples: it goes straight to the server instead of
through the conversation.`,
  inputSchema: {
    type: 'object',
    properties: {
      graph: { type: 'string', description: 'Graph IRI. Omit to target the default graph.' },
      content: { type: 'string', description: 'RDF as text. Use this or file, not both.' },
      file: { type: 'string', description: 'Path in the sandbox. Use this or content, not both.' },
      content_type: { type: 'string', description: 'Media type. Inferred from the extension when a file is used.' },
      mode: { type: 'string', description: '"replace" (PUT, default) or "merge" (POST).' },
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
    },
  },
  async run(args, ctx) {
    const hasFile = typeof args.file === 'string' && args.file !== '';
    const hasContent = typeof args.content === 'string' && args.content !== '';
    if (hasFile === hasContent) {
      throw new Error('Give exactly one of "content" or "file".');
    }

    let body: string;
    let contentType: string;
    let source: string;
    if (hasFile) {
      const read = readText(ctx.config, args.file);
      body = read.text;
      contentType = args.content_type ?? mediaTypeFor(read.path);
      source = `${read.path} (${read.bytes.toLocaleString('en')} bytes)`;
    } else {
      body = args.content;
      contentType = args.content_type ?? 'text/turtle';
      source = `${Buffer.byteLength(body, 'utf8').toLocaleString('en')} bytes inline`;
    }

    const mode = args.mode === 'merge' ? 'merge' : 'replace';
    const status = await ctx.client.writeGraph(body, {
      graph: args.graph, dataset: args.dataset, mode, contentType,
    });

    const verb = mode === 'replace' ? 'Replaced' : 'Extended';
    return `${verb} ${args.graph ? `<${args.graph}>` : 'the default graph'} from ${source}. HTTP ${status}.`;
  },
};

export const dropGraph: ToolDef = {
  name: 'drop_graph',
  writes: true,
  description: `Delete a named graph and everything in it. There is no undo.

Run backup_dataset first if the contents matter.

A 404 means the graph was already empty, which on TDB2 means it did not exist.`,
  inputSchema: {
    type: 'object',
    properties: {
      graph: { type: 'string', description: 'Graph IRI to delete.' },
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
    },
    required: ['graph'],
  },
  async run(args, ctx) {
    const graph = requireString(args, 'graph');
    const status = await ctx.client.dropGraph(graph, args.dataset);
    return `Deleted <${graph}>. HTTP ${status}.`;
  },
};

export const loadRdfFile: ToolDef = {
  name: 'load_rdf_file',
  writes: true,
  description: `Load an RDF file from the sandbox into a dataset.

Accepts Turtle, N-Triples, TriG, N-Quads, JSON-LD and RDF/XML; the media type
comes from the extension. TriG and N-Quads carry their own graph names, so do
not pass a target graph with those -- the file decides.

This exists so that bulk RDF never has to pass through the conversation. A 44 kB
ontology rewritten as INSERT DATA costs roughly 11 000 tokens; here it costs
none.`,
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path in the sandbox.' },
      graph: { type: 'string', description: 'Target graph IRI. Omit for the default graph, or for quad formats.' },
      mode: { type: 'string', description: '"merge" (default, adds) or "replace".' },
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
    },
    required: ['file'],
  },
  async run(args, ctx) {
    const read = readText(ctx.config, requireString(args, 'file'));
    if (args.graph && isQuadFormat(read.path)) {
      throw new Error(
        `${read.path} is a quad format: it names its own graphs, so "graph" would be ignored. ` +
        'Drop the graph argument, or convert the file to a triple format first.',
      );
    }
    const mode = args.mode === 'replace' ? 'replace' : 'merge';
    const status = await ctx.client.writeGraph(read.text, {
      graph: args.graph, dataset: args.dataset, mode, contentType: mediaTypeFor(read.path),
    });
    const target = args.graph ? `<${args.graph}>` : 'the dataset';
    return `Loaded ${read.path} (${read.bytes.toLocaleString('en')} bytes, ${mediaTypeFor(read.path)}) into ${target}. HTTP ${status}.`;
  },
};
