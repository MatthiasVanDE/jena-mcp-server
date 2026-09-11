# Recipes

Things people actually do with a triplestore, and how they go here.

## Explore a graph you have never seen

Ask for `dataset_stats` first. It answers the three questions that shape
everything after: how much is in there, how it is divided across named graphs,
and which types and predicates dominate.

Then `list_graphs`, and read the default-graph line carefully. If the named
graphs hold thousands of triples and the default graph holds none, every query
you write without a `GRAPH` clause will come back empty — and that looks like
broken data rather than a configuration choice.

From there `describe_resource` on one of the common types is a faster way in than
SPARQL, because it shows both directions at once.

## Keep a versioned schema in sync

The pattern: one named graph per module, replaced wholesale from the file that
defines it.

```
write_graph  graph=https://example.org/graph/schema-core  file=ontology/core.ttl   mode=replace
write_graph  graph=https://example.org/graph/schema-geo   file=ontology/geo.ttl    mode=replace
```

`replace` is a PUT: the graph becomes exactly that file. One graph per module is
what makes it safe — with both modules in one graph, replacing either would wipe
the other.

Do not do this to graphs that accumulate. A graph holding extracted facts cannot
be reconstructed from a file in your repository, and `replace` would destroy it.
Describing which graphs are static and which are dynamic in
[`JENA_CONTEXT_FILE`](configuration.md#project-context) is the way to stop a
model making that mistake.

## Load a large file

```
load_rdf_file  file=exports/full-dump.trig
```

No `graph` argument: TriG carries its own graph names. The file goes from disk
straight to Fuseki's Graph Store endpoint — none of it passes through the
conversation.

For comparison, the same content as an `INSERT DATA` statement costs roughly one
token per four bytes. A 44 kB ontology is about 11 000 tokens, and it has to be
reproduced exactly.

## Get a large result out without flooding the context

```
sparql_query  query="SELECT ?s ?p ?o WHERE { ?s ?p ?o }"  limit=0  out_file=exports/all.json
```

`limit: 0` lifts the row cap deliberately and `out_file` sends the result to
disk, so the model gets back one line naming the file and its size. Then read
the file with ordinary tools.

The same argument exists on `read_graph`.

## Create a graph

```
sparql_update  update='INSERT DATA { GRAPH <urn:example:new> { <urn:s> <urn:p> "o" } }'
```

One statement creates the graph and fills it.

`CREATE GRAPH <urn:example:new>` on its own answers 200 and produces nothing
observable: `list_graphs` will not show it, and the Graph Store Protocol returns
404 for it. On TDB2 a graph exists only once it holds a triple. This trips
people because the 200 looks like success.

## Change something destructive, safely

```
backup_dataset                      → task id
task_status  task_id=…              → finished
drop_graph   graph=…
```

`backup_dataset` writes on the server and runs in the background, so poll it
before relying on it. There is no undo for `drop_graph` or `delete_dataset`.

## Move a graph between datasets

```
read_graph   graph=https://example.org/g  dataset=source  out_file=tmp/g.ttl
write_graph  graph=https://example.org/g  dataset=target  file=tmp/g.ttl  mode=replace
```

Via a file rather than through the conversation, which also means it works for
graphs of any size.

## Let a model explore but not change anything

Run with `JENA_READ_ONLY=true`. The six writing tools are not listed, so they are
not attempted. Reading, describing, statistics and backup all still work.

Useful when pointing a model at production data, and generally the right default
for anything you did not set up yourself.

## Work out why a call failed

**405 on everything.** The dataset does not exist. Fuseki uses 405, not 404, for
an unknown dataset name. Call `list_datasets`.

**404 from `read_graph` or `drop_graph`.** The graph holds no triples. On TDB2
that is the same as not existing.

**406.** The server cannot produce the media type asked for. Normally handled
automatically; it surfaces if you pass `format` by hand.

**A query returns nothing although the data is there.** You are reading the
default graph and the data is in named graphs. Add `GRAPH ?g { … }`, or configure
the dataset with `tdb2:unionDefaultGraph true`.

**File tools refuse.** `JENA_FILES_DIR` is unset, or the path resolves outside
it.
