/** Asking questions: SPARQL in, rows or triples out. */

import type { ToolDef } from './types.js';
import { requireString } from './types.js';
import { complaints, complaintText, queryForm, isReadQuery } from '../sparql.js';
import { writeText } from '../files.js';

const SPARQL_PRIMER = `
Forms: SELECT returns rows, CONSTRUCT and DESCRIBE return triples, ASK returns a
boolean. WHERE is optional -- "SELECT ?s { ?s ?p ?o }" is valid SPARQL.

Property paths are the reason to reach for SPARQL over a REST API:
  a/b     sequence          ?s foaf:knows/foaf:name ?name
  a|b     alternative       ?s (rdfs:label|skos:prefLabel) ?label
  a*      zero or more      ?s skos:broader* ?ancestor
  a+      one or more       ?s rdfs:subClassOf+ ?super
  a?      zero or one
  ^a      inverse           ?child ^ex:hasParent ?parent
  !a      negated           ?s !rdf:type ?o

Named graphs: GRAPH <iri> { ?s ?p ?o }, or GRAPH ?g { ... } to range over all of
them. Note that a query without a GRAPH clause reads the default graph, which on
many datasets is empty unless the store is configured with a union default graph.
`.trim();

export const sparqlQuery: ToolDef = {
  name: 'sparql_query',
  writes: false,
  wantsProjectContext: true,
  description: `Run a read-only SPARQL query (SELECT, CONSTRUCT, ASK or DESCRIBE).

${SPARQL_PRIMER}

Results are capped. A SELECT without its own LIMIT gets one appended (see
default_limit), because an unbounded exploration query over even a small dataset
can return hundreds of thousands of characters. Pass limit: 0 to lift the cap
deliberately, and out_file to send a large result to disk instead of through the
conversation.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The SPARQL query.' },
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
      limit: {
        type: 'number',
        description: 'Row cap for a SELECT that sets none itself. 0 lifts it. Defaults to the server setting.',
      },
      out_file: {
        type: 'string',
        description: 'Write the result here (inside the file sandbox) and return only the path and size.',
      },
    },
    required: ['query'],
  },
  async run(args, ctx) {
    const query = requireString(args, 'query');

    const problems = complaints(query);
    if (problems.length > 0) {
      throw new Error(`This query will not parse:\n${complaintText(problems)}`);
    }
    if (!isReadQuery(query)) {
      throw new Error(
        `This is ${queryForm(query)}, not a read query. Use sparql_update for anything that changes data.`,
      );
    }

    const { body, applied } = await ctx.client.query(query, {
      dataset: args.dataset,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    });

    const note = applied !== query ? `\n\n(A LIMIT was appended; pass limit: 0 to lift it.)` : '';

    if (args.out_file) {
      const written = writeText(ctx.config, args.out_file, body);
      return `Wrote ${written.bytes.toLocaleString('en')} bytes to ${written.path}.${note}`;
    }
    return ctx.cap(body, 'query result') + note;
  },
};

export const sparqlUpdate: ToolDef = {
  name: 'sparql_update',
  writes: true,
  wantsProjectContext: true,
  description: `Run a SPARQL Update: INSERT, DELETE, LOAD, CLEAR, CREATE, DROP, COPY, MOVE or ADD.

To create a named graph, insert into it:
  INSERT DATA { GRAPH <iri> { <s> <p> "o" } }

CREATE GRAPH on its own is not enough on TDB2. It answers 200, but a graph with
no triples does not exist as far as anything else is concerned -- list_graphs
will not show it and the Graph Store Protocol answers 404 for it.

For replacing a whole graph from a file, write_graph and load_rdf_file are
better: they do not put the RDF through this conversation.`,
  inputSchema: {
    type: 'object',
    properties: {
      update: { type: 'string', description: 'The SPARQL Update statement.' },
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
    },
    required: ['update'],
  },
  async run(args, ctx) {
    const update = requireString(args, 'update');
    const problems = complaints(update);
    if (problems.length > 0) {
      throw new Error(`This update will not parse:\n${complaintText(problems)}`);
    }
    if (isReadQuery(update)) {
      throw new Error(
        `This is a ${queryForm(update)} query, not an update. Use sparql_query to read.`,
      );
    }
    await ctx.client.update(update, args.dataset);
    return `Update applied to ${args.dataset || ctx.config.dataset}.`;
  },
};

export const describeResource: ToolDef = {
  name: 'describe_resource',
  writes: false,
  wantsProjectContext: true,
  description: `Everything the store knows about one IRI, in both directions.

Returns the triples where the IRI is the subject and, unless you turn it off,
those where it is the object -- which is usually where the interesting part is,
because it shows what points *at* the thing.

Faster to reach for than writing the query by hand, and it names the graph each
triple came from.`,
  inputSchema: {
    type: 'object',
    properties: {
      iri: { type: 'string', description: 'The IRI to describe, without angle brackets.' },
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
      incoming: { type: 'boolean', description: 'Include triples pointing at the IRI. Default true.' },
      limit: { type: 'number', description: 'Maximum triples per direction. Default 200.' },
    },
    required: ['iri'],
  },
  async run(args, ctx) {
    const iri = requireString(args, 'iri').replace(/^<|>$/g, '');
    const limit = typeof args.limit === 'number' ? args.limit : 200;
    const incoming = args.incoming !== false;

    const outgoing = await ctx.client.queryJson(
      `SELECT ?g ?p ?o WHERE {
         { GRAPH ?g { <${iri}> ?p ?o } } UNION { <${iri}> ?p ?o }
       } LIMIT ${limit}`,
      { dataset: args.dataset, limit: 0 },
    );

    const lines: string[] = [`<${iri}>`, ''];
    const out = outgoing.results?.bindings ?? [];
    lines.push(`outgoing (${out.length}${out.length === limit ? ', truncated' : ''}):`);
    for (const row of out) {
      const graph = row.g ? `  [${row.g.value}]` : '';
      lines.push(`  ${row.p?.value} -> ${format(row.o)}${graph}`);
    }

    if (incoming) {
      const inbound = await ctx.client.queryJson(
        `SELECT ?g ?s ?p WHERE {
           { GRAPH ?g { ?s ?p <${iri}> } } UNION { ?s ?p <${iri}> }
         } LIMIT ${limit}`,
        { dataset: args.dataset, limit: 0 },
      );
      const inb = inbound.results?.bindings ?? [];
      lines.push('', `incoming (${inb.length}${inb.length === limit ? ', truncated' : ''}):`);
      for (const row of inb) {
        const graph = row.g ? `  [${row.g.value}]` : '';
        lines.push(`  ${row.s?.value} -${row.p?.value}->${graph}`);
      }
    }

    if (out.length === 0 && !incoming) lines.push('  (nothing)');
    return ctx.cap(lines.join('\n'), 'description');
  },
};

function format(term: { type: string; value: string; datatype?: string; 'xml:lang'?: string } | undefined): string {
  if (!term) return '?';
  if (term.type === 'uri') return `<${term.value}>`;
  const lang = term['xml:lang'] ? `@${term['xml:lang']}` : '';
  const type = term.datatype ? `^^<${term.datatype}>` : '';
  return `"${term.value}"${lang}${type}`;
}
