# jena-mcp-server

Give a language model a working connection to [Apache Jena Fuseki](https://jena.apache.org/documentation/fuseki2/):
SPARQL queries and updates, whole named graphs over the Graph Store Protocol,
bulk RDF loading from disk, and dataset administration — sixteen tools over the
[Model Context Protocol](https://modelcontextprotocol.io/).

```
┌─ your MCP client ─┐        ┌─ jena-mcp-server ─┐        ┌─ Fuseki ────────┐
│  Claude Code,     │ stdio  │  16 tools         │  HTTP  │  SPARQL         │
│  Claude Desktop,  │◄──────►│  graphs as        │◄──────►│  Graph Store    │
│  Cursor, …        │        │  resources        │        │  /$/ admin      │
└───────────────────┘        └───────────────────┘        └─────────────────┘
```

## Why this exists

A triplestore is an awkward thing to hand to a model. The obvious approach —
one tool that takes a SPARQL string — falls over in practice for three reasons,
and this server is built around all three:

**Unbounded queries flood the context.** `SELECT ?s ?p ?o WHERE { ?s ?p ?o }` is
the first thing anyone writes against an unfamiliar graph. Over a dataset of
1 600 triples it serialises to roughly 630 000 characters — about 157 000 tokens
in a single tool result. Here a SELECT without its own `LIMIT` gets one, every
result has a character ceiling, and anything genuinely large goes to a file
instead.

**SPARQL is the wrong tool for whole graphs.** Reading a graph with `CONSTRUCT`
puts it through the query parser and back out as a result set; replacing one
means `DELETE` followed by an `INSERT DATA` carrying the entire content as query
text. The Graph Store Protocol does both in one request, and this server exposes
it directly — including loading a `.ttl` file from disk, which never enters the
conversation at all.

**Administration is where the sharp edges are.** Fuseki answers **405, not 404**,
for a dataset that does not exist. Without a way to list datasets, that error is
indistinguishable from a wrong endpoint path. And `CREATE GRAPH` on TDB2 returns
200 while creating nothing you can observe — an empty graph and a missing graph
are the same thing. Both are documented in the tool descriptions, where the
model will actually read them.

## Install

```sh
npm install -g jena-mcp-server
```

Or from source:

```sh
git clone https://github.com/MatthiasVanDE/jena-mcp-server.git
cd jena-mcp-server && npm install && npm run build
```

Node 20 or newer. One runtime dependency: the MCP SDK.

## Connect it

**Claude Code**

```sh
claude mcp add jena \
  -e JENA_ENDPOINT=http://localhost:3030 \
  -e JENA_DATASET=mydata \
  -- npx -y jena-mcp-server
```

**Claude Desktop** — in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jena": {
      "command": "npx",
      "args": ["-y", "jena-mcp-server"],
      "env": {
        "JENA_ENDPOINT": "http://localhost:3030",
        "JENA_DATASET": "mydata",
        "JENA_USERNAME": "admin",
        "JENA_PASSWORD": "…"
      }
    }
  }
}
```

Putting a password in a client config file means it sits there in plain text.
[docs/configuration.md](docs/configuration.md#keeping-the-password-out-of-client-config)
shows a two-line wrapper that keeps it in one place instead.

## The sixteen tools

| | |
|---|---|
| **Querying** | `sparql_query` · `sparql_update` · `describe_resource` |
| **Graphs** | `list_graphs` · `read_graph` · `write_graph` · `drop_graph` · `load_rdf_file` |
| **Datasets** | `list_datasets` · `dataset_stats` · `create_dataset` · `delete_dataset` |
| **Server** | `server_info` · `backup_dataset` · `compact_dataset` · `task_status` |

Named graphs are also exposed as MCP **resources**, so a client can pull one in
without composing a query.

Full reference: [docs/tools.md](docs/tools.md).

## Two settings worth knowing before you start

**`JENA_FILES_DIR`** is the only directory the file tools may touch, and until
you set it they refuse to run. That is deliberate: a tool that "loads a file into
the triplestore" is, unfenced, a tool that can ship any readable file on the
machine to a remote server.

**`JENA_READ_ONLY=true`** hides the six writing tools rather than refusing them
on call. A model does not attempt what it is not offered.

Everything else: [docs/configuration.md](docs/configuration.md).

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | from zero to a graph you can query |
| [Tool reference](docs/tools.md) | every tool, argument and failure mode |
| [Configuration](docs/configuration.md) | all settings, and how to keep secrets out of config files |
| [Recipes](docs/recipes.md) | schema sync, bulk loading, exploring an unknown graph |
| [Design notes](docs/design.md) | why it is built this way |

## Development

```sh
npm run build     # compile
npm test          # unit tests, no server needed
npm run check     # both
```

The unit tests cover the parts where being wrong is quiet: which SPARQL form a
string is, when a row cap may be appended, and what the file sandbox lets
through.

## Licence and acknowledgement

MIT — see [LICENSE](LICENSE).

This is an independent implementation. It was written after working with
[ramuzes/mcp-jena](https://github.com/ramuzes/mcp-jena) (MIT, © 2025 ramuz),
which demonstrated the idea of an MCP server for Jena; no code from it is
included here, but credit for the starting point belongs there.
