# Tool reference

Sixteen tools in four groups. Every one takes an optional `dataset` argument that
overrides the configured default, except where noted.

Tools marked **writes** are hidden and refused when the server runs with
`JENA_READ_ONLY=true`.

---

## Querying

### `sparql_query`

Runs SELECT, CONSTRUCT, ASK or DESCRIBE.

| argument | |
|---|---|
| `query` | the SPARQL, required |
| `dataset` | override the default dataset |
| `limit` | row cap for a SELECT that sets none; `0` lifts it |
| `out_file` | write the result into the file sandbox and return only path and size |

The Accept header follows the query form: SELECT and ASK ask for
`application/sparql-results+json`, CONSTRUCT and DESCRIBE for `text/turtle`.
Getting that wrong earns a 406, which is why the form is determined from the
first real keyword rather than from whether a word appears — a sub-SELECT inside
a CONSTRUCT is still a CONSTRUCT.

Refuses updates: pass those to `sparql_update`.

**The row cap.** A SELECT with no `LIMIT` gets `LIMIT 1000` appended (configurable,
`0` to disable). Only SELECT: on ASK it means nothing, and on CONSTRUCT or
DESCRIBE it would quietly change which triples come back. A query that carries
its own `LIMIT` keeps it.

### `sparql_update`  — **writes**

INSERT, DELETE, LOAD, CLEAR, CREATE, DROP, COPY, MOVE, ADD, WITH.

| argument | |
|---|---|
| `update` | the update statement, required |
| `dataset` | override the default dataset |

Refuses read queries, so a mistyped tool name fails loudly instead of doing
nothing.

For replacing a whole graph, `write_graph` and `load_rdf_file` are better: they
do not route the RDF through the conversation.

### `describe_resource`

Everything the store knows about one IRI, in both directions.

| argument | |
|---|---|
| `iri` | the IRI, required, with or without angle brackets |
| `incoming` | include triples pointing *at* it (default `true`) |
| `limit` | maximum triples per direction (default 200) |

The incoming half is usually the interesting one: it shows what refers to the
thing. Each triple is labelled with the graph it came from.

---

## Graphs

### `list_graphs`

Named graphs with a triple count each, plus the size of the default graph
reported separately.

That separation matters. A query without a `GRAPH` clause reads the default
graph, and on a store without a union default graph it is often empty while the
named graphs are full — which looks exactly like "the data is missing".

Only graphs holding at least one triple appear. On TDB2 that is the complete
set: an empty graph is indistinguishable from one that was never created.

### `read_graph`

One graph, whole, as Turtle.

| argument | |
|---|---|
| `graph` | graph IRI; omit for the default graph |
| `format` | media type to request (default `text/turtle`) |
| `out_file` | write to the sandbox instead of returning |

One request, no query parser. A 404 means the graph holds no triples — it is not
an error about the endpoint.

### `write_graph`  — **writes**

Replace or extend one graph.

| argument | |
|---|---|
| `graph` | graph IRI; omit for the default graph |
| `content` | RDF as text — this **or** `file` |
| `file` | path in the sandbox — this **or** `content` |
| `content_type` | media type; inferred from the extension for files |
| `mode` | `replace` (PUT, default) or `merge` (POST) |

`replace` makes the graph exactly what you send. This is how a versioned schema
is kept in sync: one graph per module, so that updating one cannot wipe another.

### `drop_graph`  — **writes**

Deletes a graph and everything in it. No undo; run `backup_dataset` first if it
matters. A 404 means it was already empty.

### `load_rdf_file`  — **writes**

Loads an RDF file from the sandbox straight into the dataset.

| argument | |
|---|---|
| `file` | path in the sandbox, required |
| `graph` | target graph; omit for the default graph |
| `mode` | `merge` (default) or `replace` |

Turtle, N-Triples, TriG, N-Quads, JSON-LD and RDF/XML. The media type comes from
the extension, and getting it right matters — Fuseki parses by what the
Content-Type claims, so a TriG file announced as Turtle fails on its first graph
block.

TriG and N-Quads carry their own graph names. Passing `graph` with one of those
is refused rather than silently ignored.

---

## Datasets

### `list_datasets`

Every dataset on the server with the endpoints it offers.

Reach for this when something returns 405. Fuseki uses that status for a dataset
name it does not know, which reads like "wrong method" and means "no such
dataset".

The endpoint names are worth reading too: a dataset configured through an
assembler file often exposes only `sparql`, while stock Fuseki also accepts
`query`.

### `dataset_stats`

Triples in total, in the default graph, the number of named graphs, and the most
common types and predicates. A quick orientation in a store you have not seen.

| argument | |
|---|---|
| `top` | how many types and predicates to list (default 10) |

### `create_dataset`  — **writes**

| argument | |
|---|---|
| `name` | dataset name, required |
| `kind` | `tdb2` (default, persistent) or `mem` (in-memory) |

`mem` is gone when the server stops. Useful as scratch space, a trap if you meant
to keep the data.

### `delete_dataset`  — **writes**

| argument | |
|---|---|
| `name` | dataset name, required |
| `confirm` | must be `true` |

Removes the dataset **and deletes its files**. The `confirm` argument is a guard
against deleting by autocomplete.

---

## Server

### `server_info`

Version, uptime, and per-dataset request statistics. Worth calling first to
confirm you are talking to the server you think you are.

### `backup_dataset`

Starts a server-side backup and returns a task id. The backup is written on the
server, in Fuseki's backups directory.

Counted as a read tool: it copies data out rather than changing it, so it stays
available under `JENA_READ_ONLY`.

### `compact_dataset`  — **writes**

Reclaims space held by superseded TDB2 data. `delete_old: true` removes the
pre-compaction copy, which frees the most and cannot be undone.

### `task_status`

State of a background task. A finished task reports a `finished` timestamp.

---

## Resources

Every named graph is also an MCP resource, listed as `graph://<encoded-iri>` and
readable as Turtle. Same content as `read_graph`, reachable without a tool call.

Resource reads pass through the same character ceiling as everything else.
