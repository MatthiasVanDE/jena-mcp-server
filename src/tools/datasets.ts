/** Datasets: what exists on this server, and making or removing one. */

import type { ToolDef } from './types.js';
import { requireString } from './types.js';

export const listDatasets: ToolDef = {
  name: 'list_datasets',
  writes: false,
  description: `List the datasets on this Fuseki server and the endpoints each offers.

Reach for this first when a call fails with 405. Fuseki answers 405 -- not 404 --
for a dataset name it does not know, which reads like "wrong method" when it
actually means "no such dataset".

The endpoint names matter too. A dataset configured through an assembler file
often exposes only "sparql", while Fuseki's stock configuration also accepts
"query". This shows which one you have.`,
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx) {
    const datasets = await ctx.client.datasets();
    if (datasets.length === 0) {
      return 'This server has no datasets.';
    }
    const lines = datasets.map((ds) => {
      const services = Object.entries(ds.endpoints)
        .map(([kind, names]) => `${kind}: ${names.filter(Boolean).join(', ') || '(unnamed)'}`)
        .join('  |  ');
      return `  ${ds.name}${ds.active ? '' : '  [inactive]'}\n      ${services}`;
    });
    return [`${datasets.length} dataset(s):`, ...lines].join('\n');
  },
};

export const datasetStats: ToolDef = {
  name: 'dataset_stats',
  writes: false,
  description: `Size and shape of a dataset: triple counts, graphs, classes and properties.

A quick orientation for a store you have not seen before -- how much is in it,
how it is divided over graphs, and which types and predicates dominate.`,
  inputSchema: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
      top: { type: 'number', description: 'How many classes and predicates to list. Default 10.' },
    },
  },
  async run(args, ctx) {
    const dataset = args.dataset || ctx.config.dataset;
    const top = typeof args.top === 'number' ? args.top : 10;

    const [everything, defaultGraph, graphCount] = await Promise.all([
      ctx.client.count('SELECT (COUNT(*) AS ?n) WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }', dataset),
      ctx.client.count('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }', dataset),
      ctx.client.count('SELECT (COUNT(DISTINCT ?g) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } }', dataset),
    ]);

    const classes = await ctx.client.queryJson(
      `SELECT ?type (COUNT(*) AS ?n) WHERE {
         { ?s a ?type } UNION { GRAPH ?g { ?s a ?type } }
       } GROUP BY ?type ORDER BY DESC(?n) LIMIT ${top}`,
      { dataset, limit: 0 },
    );
    const predicates = await ctx.client.queryJson(
      `SELECT ?p (COUNT(*) AS ?n) WHERE {
         { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } }
       } GROUP BY ?p ORDER BY DESC(?n) LIMIT ${top}`,
      { dataset, limit: 0 },
    );

    const table = (rows: { value: string; n: number }[]) =>
      rows.length === 0 ? ['  (none)']
        : rows.map((r) => `  ${String(r.n).padStart(8)}  ${r.value}`);

    const pick = (json: typeof classes, key: string) =>
      (json.results?.bindings ?? []).map((b) => ({
        value: b[key]?.value ?? '?', n: Number(b.n?.value ?? 0),
      }));

    return [
      `Dataset "${dataset}"`,
      `  ${everything.toLocaleString('en')} triples in total`,
      `  ${defaultGraph.toLocaleString('en')} in the default graph`,
      `  ${graphCount} named graph(s)`,
      '',
      `Most common types:`,
      ...table(pick(classes, 'type')),
      '',
      `Most common predicates:`,
      ...table(pick(predicates, 'p')),
    ].join('\n');
  },
};

export const createDataset: ToolDef = {
  name: 'create_dataset',
  writes: true,
  description: `Create a dataset on the server.

kind "tdb2" (the default) is persistent and survives a restart; "mem" is
in-memory and is gone when the server stops -- useful for a scratch space, and a
trap if you meant to keep the data.

Fuseki writes a configuration file for the new dataset, so it comes back after a
restart. A dataset created this way has the stock endpoints: sparql, query,
update, data and get.`,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Dataset name, without a leading slash.' },
      kind: { type: 'string', description: '"tdb2" (default, persistent) or "mem" (in-memory).' },
    },
    required: ['name'],
  },
  async run(args, ctx) {
    const name = requireString(args, 'name').replace(/^\//, '');
    const kind = args.kind === 'mem' ? 'mem' : args.kind === 'tdb' ? 'tdb' : 'tdb2';
    await ctx.client.createDataset(name, kind);
    const note = kind === 'mem'
      ? ' It is in-memory: everything in it is lost when the server stops.'
      : '';
    return `Created dataset "${name}" (${kind}).${note}`;
  },
};

export const deleteDataset: ToolDef = {
  name: 'delete_dataset',
  writes: true,
  description: `Remove a dataset from the server and delete its files. Irreversible.

This is not "unmount": the data on disk goes too. Take a backup first if there is
anything in it you would miss.`,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Dataset name to remove.' },
      confirm: { type: 'boolean', description: 'Must be true. A guard against deleting by autocomplete.' },
    },
    required: ['name', 'confirm'],
  },
  async run(args, ctx) {
    const name = requireString(args, 'name').replace(/^\//, '');
    if (args.confirm !== true) {
      throw new Error(
        `Refusing to delete "${name}": pass confirm: true. This deletes the data on disk as well.`,
      );
    }
    await ctx.client.deleteDataset(name);
    return `Deleted dataset "${name}" and its files.`;
  },
};
