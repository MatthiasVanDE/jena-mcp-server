#!/usr/bin/env node
/**
 * jena-mcp-server -- an MCP server for Apache Jena Fuseki.
 *
 * Speaks JSON-RPC over stdin/stdout. Everything this process prints for humans
 * goes to stderr, because stdout is the protocol: a single stray line there
 * breaks the session, and the failure looks like the server never started.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, describe } from './config.js';
import { FusekiClient, FusekiError } from './fuseki.js';
import { loadContext, renderContext } from './context.js';
import { toolsFor, findTool } from './tools/index.js';
import type { ToolContext } from './tools/index.js';

const VERSION = '1.0.0';

const config = loadConfig();
const client = new FusekiClient(config);
const project = loadContext(config.contextFile);
const projectBlock = renderContext(project);

console.error(`[jena-mcp-server ${VERSION}] ${describe(config)}`);
if (config.contextFile && Object.keys(project).length > 0) {
  console.error(`[jena-mcp-server] project context: ${config.contextFile}`);
}

/**
 * Cuts a result down to the configured ceiling, and says so.
 *
 * Silence here would be worse than the truncation: a caller that does not know
 * the tail is missing will reason about a partial answer as if it were whole.
 */
function cap(text: string, what = 'result'): string {
  if (text.length <= config.maxResultChars) return text;
  const dropped = text.length - config.maxResultChars;
  return (
    text.slice(0, config.maxResultChars) +
    `\n\n--- truncated ---\n` +
    `This ${what} is ${text.length.toLocaleString('en')} characters; ` +
    `${dropped.toLocaleString('en')} were dropped at the ${config.maxResultChars.toLocaleString('en')} ` +
    `character ceiling (JENA_MAX_RESULT_CHARS).\n` +
    `Narrow the query, add LIMIT/OFFSET, or pass out_file to write the whole thing to disk.`
  );
}

const toolContext: ToolContext = { config, client, project, cap };

const server = new Server(
  { name: 'jena-mcp-server', version: VERSION },
  { capabilities: { tools: {}, resources: {} } },
);

// -- tools -------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolsFor(config.readOnly).map((tool) => ({
    name: tool.name,
    description: tool.description + (tool.wantsProjectContext ? projectBlock : ''),
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const tool = findTool(name);

  if (!tool) {
    return fail(`No such tool: ${name}. Available: ${toolsFor(config.readOnly).map((t) => t.name).join(', ')}`);
  }

  // Checked before anything else, so a refusal never reaches the network.
  if (config.readOnly && tool.writes) {
    return fail(
      `${name} writes, and this server is running read-only (JENA_READ_ONLY / --read-only). ` +
      `Restart without that setting to allow changes.`,
    );
  }

  try {
    const text = await tool.run(request.params.arguments ?? {}, toolContext);
    return { content: [{ type: 'text' as const, text }], isError: false };
  } catch (error) {
    if (error instanceof FusekiError) return fail(error.toString());
    return fail(error instanceof Error ? error.message : String(error));
  }
});

function fail(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

// -- resources ---------------------------------------------------------------
//
// Every named graph is also readable as a resource, so a client can pull one in
// without composing a query for it. Same data, lower ceremony.

const GRAPH_SCHEME = 'graph://';

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const rows = await client.queryJson(
      'SELECT ?g (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g ORDER BY DESC(?n)',
      { limit: 0 },
    );
    return {
      resources: (rows.results?.bindings ?? []).map((b) => ({
        uri: `${GRAPH_SCHEME}${encodeURIComponent(b.g?.value ?? '')}`,
        name: b.g?.value ?? 'unnamed graph',
        description: `Named graph in dataset "${config.dataset}", ${b.n?.value ?? '?'} triples.`,
        mimeType: 'text/turtle',
      })),
    };
  } catch (error) {
    console.error(`[jena-mcp-server] could not list graphs: ${(error as Error).message}`);
    return { resources: [] };
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (!uri.startsWith(GRAPH_SCHEME)) {
    throw new Error(`Unsupported resource URI: ${uri}. Expected ${GRAPH_SCHEME}<graph-iri>.`);
  }
  const graph = decodeURIComponent(uri.slice(GRAPH_SCHEME.length));
  const turtle = await client.readGraph(graph);
  return {
    contents: [{ uri, mimeType: 'text/turtle', text: cap(turtle, 'graph') }],
  };
});

// -- go ----------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[jena-mcp-server] ready, ${toolsFor(config.readOnly).length} tools`);
}

main().catch((error) => {
  console.error(`[jena-mcp-server] fatal: ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
