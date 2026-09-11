# Getting started

From nothing to a graph you can ask questions about, in four steps.

## 1. Have a Fuseki

If one is already running, skip ahead. Otherwise the quickest route is Docker:

```sh
docker run -d --name fuseki -p 127.0.0.1:3030:3030 \
  -e ADMIN_PASSWORD=secret \
  stain/jena-fuseki
```

Bind to `127.0.0.1` rather than all interfaces unless you have TLS and a proxy in
front. A triplestore with a writable update endpoint on an open port is not a
thing to leave lying around.

Check it answers:

```sh
curl -s http://localhost:3030/$/ping
```

## 2. Create a dataset

Through Fuseki's own UI at `http://localhost:3030`, or let this server do it once
it is connected (`create_dataset`).

Name it something you will recognise; the name appears in every URL:
`/mydata/sparql`, `/mydata/update`, `/mydata/data`.

## 3. Connect the server

```sh
claude mcp add jena \
  -e JENA_ENDPOINT=http://localhost:3030 \
  -e JENA_DATASET=mydata \
  -e JENA_USERNAME=admin \
  -e JENA_PASSWORD=secret \
  -e JENA_FILES_DIR="$PWD/rdf" \
  -- npx -y jena-mcp-server
```

`JENA_FILES_DIR` is optional but you will want it: without it, `load_rdf_file`
and every `out_file` argument refuse to work. Point it at the directory holding
your `.ttl` files.

Confirm the connection — ask the model to call `server_info`. It should report a
Fuseki version and an uptime. If it reports 405 on something, call
`list_datasets`: Fuseki uses that status for a dataset name it does not know.

## 4. Put something in it

With a file:

> Load `ontology.ttl` into the graph `urn:example:schema`.

The model calls `load_rdf_file`, and the RDF goes from disk straight to Fuseki
without passing through the conversation.

Or inline, for a handful of triples:

> Add a triple saying that `urn:example:thing` has the label "A thing".

which becomes

```sparql
INSERT DATA {
  GRAPH <urn:example:schema> {
    <urn:example:thing> <http://www.w3.org/2000/01/rdf-schema#label> "A thing"
  }
}
```

Note the `GRAPH` block. `CREATE GRAPH <urn:example:schema>` on its own would
answer 200 and create nothing observable — on TDB2 a graph exists only once it
holds a triple.

## 5. Look around

> What is in this dataset?

`dataset_stats` gives the shape of it: triple counts, how many named graphs, the
most common types and predicates. `list_graphs` gives the graphs with their
sizes, and tells you whether the *default* graph is empty — which matters,
because a query without a `GRAPH` clause reads that one.

From there, `describe_resource` on any IRI shows what it says and what points at
it, which is usually the faster way in than writing SPARQL by hand.

## Where things go wrong

**Everything returns 405.** The dataset name is wrong. Fuseki answers 405, not
404, for an unknown dataset. `list_datasets` shows what exists.

**Queries return nothing although the data is there.** Your triples are in named
graphs and your query reads the default graph. Either add `GRAPH ?g { … }`, or
configure the dataset with a union default graph — in an assembler file,
`tdb2:unionDefaultGraph true`.

**A graph you created is not listed.** It has no triples. See above.

**File tools refuse to run.** `JENA_FILES_DIR` is unset, or the path you gave
resolves outside it.

Next: the [tool reference](tools.md), or [recipes](recipes.md) for the things
people actually do.
