# Configuration

Everything is an environment variable. A few also have a command line flag, for
when you are debugging by hand.

## Connection

| variable | flag | default | |
|---|---|---|---|
| `JENA_ENDPOINT` | `-e`, `--endpoint` | `http://localhost:3030` | Fuseki base URL |
| `JENA_DATASET` | `-d`, `--dataset` | `ds` | dataset used when a call names none |
| `JENA_USERNAME` | `-u`, `--username` | — | HTTP Basic user |
| `JENA_PASSWORD` | `-p`, `--password` | — | HTTP Basic password |
| `JENA_TIMEOUT_MS` | — | `60000` | request timeout |

`FUSEKI_URL` is accepted as a synonym for `JENA_ENDPOINT`.

## Endpoint paths

| variable | flag | default |
|---|---|---|
| `JENA_QUERY_PATH` | `--query-path` | `sparql` |
| `JENA_UPDATE_PATH` | `--update-path` | `update` |
| `JENA_GRAPH_STORE_PATH` | `--graph-store-path` | `data` |

These are the names *under* a dataset: `/mydata/sparql`, `/mydata/update`,
`/mydata/data`.

The default for queries is `sparql` rather than `query`, and that choice is not
arbitrary. Fuseki's stock configuration registers a query service under both
names, but a dataset that declares its own endpoints in an assembler file
usually declares only `sparql`. Defaulting to `sparql` works in both cases;
defaulting to `query` returns 404 on the second.

`list_datasets` shows which names your datasets actually offer.

## Limits

| variable | default | |
|---|---|---|
| `JENA_DEFAULT_LIMIT` | `1000` | row cap appended to a SELECT with no `LIMIT`; `0` disables |
| `JENA_MAX_RESULT_CHARS` | `100000` | ceiling on any tool result, in characters |

Both exist for the same reason. `SELECT ?s ?p ?o WHERE { ?s ?p ?o }` is the first
query anyone writes against an unfamiliar graph, and over a dataset of 1 600
triples it produces about 630 000 characters — roughly 157 000 tokens, in one
tool result, before the model has learned anything.

The row cap prevents most of that; the character ceiling catches the rest,
including CONSTRUCT output and graph reads, where a row cap does not apply. When
it trims, it says so — a caller that does not know the tail is missing will
reason about a partial answer as though it were complete.

Raise them if your context window is large and your graphs are small. Setting
`JENA_DEFAULT_LIMIT=0` globally is rarely what you want; pass `limit: 0` on the
individual call instead.

## File access

| variable | flag | default |
|---|---|---|
| `JENA_FILES_DIR` | `--files-dir` | *(empty — file access disabled)* |

The only directory `load_rdf_file`, `write_graph`'s `file` argument and every
`out_file` may touch. Relative paths resolve inside it; absolute paths must
already be within it; `..` cannot climb out.

Leaving it empty disables file access entirely, and that is the default on
purpose. A tool that loads a file into a triplestore is otherwise a tool that can
ship any readable file on the machine to a remote server.

Point it at the directory holding your RDF, not at your home directory.

## Read-only

| variable | flag | default |
|---|---|---|
| `JENA_READ_ONLY` | `--read-only` | `false` |

When on, the six writing tools — `sparql_update`, `write_graph`, `drop_graph`,
`load_rdf_file`, `create_dataset`, `delete_dataset`, `compact_dataset` — are not
listed at all, and are refused before any request leaves if called anyway.

Hiding rather than refusing is the point: a model does not attempt what it is not
offered.

`backup_dataset` stays available. It copies data out; it does not change it.

## Project context

| variable | flag | default |
|---|---|---|
| `JENA_CONTEXT_FILE` | `--context-file` | — |

Points at a JSON file describing *your* graph. Its contents are appended to the
descriptions of the SPARQL tools, so the model sees them at the moment it writes
a query.

```json
{
  "prefixes": {
    "ex": "https://example.org/ontology#",
    "skos": "http://www.w3.org/2004/02/skos/core#"
  },
  "graphs": [
    {
      "iri": "https://example.org/graph/schema",
      "purpose": "Classes and properties. What can exist.",
      "kind": "static",
      "writtenBy": "the ontology files in git"
    },
    {
      "iri": "https://example.org/graph/facts",
      "purpose": "Extracted statements about instances.",
      "kind": "dynamic",
      "writtenBy": "the extraction pipeline"
    }
  ],
  "notes": "Static graphs are replaced wholesale with write_graph; dynamic graphs accumulate. Never replace a dynamic graph from a file in the repository — it cannot be reconstructed from one."
}
```

Without this, a model writes full IRIs it has guessed and invents graph names.
With it, it uses your prefixes and puts triples where they belong.

The file belongs to a deployment, not to this package, which is why it is a path
rather than something baked in.

## Keeping the password out of client config

`claude mcp add … -e JENA_PASSWORD=secret` writes that value verbatim into the
client's configuration file. If you would rather it lived in one place, register
a wrapper instead:

```sh
#!/bin/bash
set -euo pipefail
set -a
source "$HOME/.config/jena-mcp/env"   # mode 0600
set +a
exec npx -y jena-mcp-server "$@"
```

```sh
claude mcp add jena -- /path/to/wrapper.sh
```

Two details matter. `exec`, so no shell sits between the client and the server on
stdio. And nothing printed to stdout — that is the JSON-RPC channel, and a single
stray line breaks the session in a way that looks like the server never started.

If you let the wrapper accept overrides (`JENA_READ_ONLY=true wrapper.sh`),
remember that `source` overwrites what the caller passed. Save the pre-existing
values before sourcing and restore them after, or the override silently does
nothing.
