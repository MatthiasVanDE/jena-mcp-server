# Design notes

Why the server is shaped the way it is. Useful if you are changing it, or
deciding whether to trust it.

## One dependency

The MCP SDK, and nothing else. HTTP goes through the platform's own `fetch`,
which has been stable since Node 18, and the tests run on `node:test`. A server
that sits between a language model and a database is a poor place to accumulate
transitive dependencies.

## Tools are objects, not switch cases

Each tool is one object carrying its name, description, schema and
implementation together, collected in a single list in `src/tools/index.ts`.

The obvious alternative — schemas declared in one place, a `switch` over tool
names in another — drifts. A parameter gets added to the schema and not to the
handler, and nothing notices until a model passes it. Keeping them adjacent makes
that mismatch visible while editing.

## The form of a query is decided before it is sent

Two decisions have to be made client-side: which `Accept` header to use, and
whether a row cap may be appended. Both depend on what kind of SPARQL the string
is.

`src/sparql.ts` determines that from the **first keyword that is really a
keyword**, after blanking string literals, IRIs and comments in a single pass.
The order of alternatives in that pass is load-bearing:

- Looking for any occurrence of `SELECT` makes
  `CONSTRUCT { ?s ?p ?o } WHERE { { SELECT … } }` a SELECT, which asks for JSON
  where the server will produce Turtle, and earns a 406.
- Stripping comments *before* IRIs makes the `#` in `<urn:example:graph#part>`
  look like a line comment, swallowing the rest of the line — braces included.
  Every hash namespace hits this. It was a real bug here, and there are two
  regression tests pinning it.

This is not a parser and does not try to be. Fuseki has one, and its errors are
better than anything reimplemented here would produce.

## Validation refuses very little

Client-side checks catch four things: an empty string, unbalanced braces or
parentheses, a trailing dot after `PREFIX` (Turtle habit, SPARQL error), and a
string with no SPARQL keyword at all.

Everything else goes to the server. A validator that rejects valid SPARQL is
worse than none, and the tempting rules are exactly the wrong ones: `WHERE` is
optional, so `SELECT ?s { ?s ?p ?o }` is valid; `FILTER` needs a group pattern,
not the word `WHERE`. Both are pinned by tests.

## Limits are on by default

The row cap and the character ceiling both apply unless turned off. That is the
opposite of how most clients are built, and it follows from what goes wrong in
practice: the failure is not a slow query, it is a correct query whose result
fills the context window before anything has been learned from it. Measured on a
1 600-triple dataset, an unbounded `SELECT ?s ?p ?o` returns ~630 000 characters.

When the ceiling trims, the result says so explicitly. Silent truncation would be
worse than no limit at all — a caller reasons about a partial answer as though it
were whole.

## File access is fenced, and off by default

`JENA_FILES_DIR` is the only directory the file tools may touch, checked after
path resolution so `..` cannot escape. Unset, file access is disabled entirely.

The reasoning is that "load a file into the triplestore" and "exfiltrate any
readable file to a remote server" are the same operation with different
arguments. The fence is what distinguishes them, so it is not optional and the
default is closed.

## Read-only hides rather than refuses

`JENA_READ_ONLY` removes writing tools from the listing. A model does not attempt
what it was never offered, which is a stronger guarantee than refusing on call.

The refusal exists as well, checked before any network request — but as a
backstop, for a client that cached an older tool list.

Placement matters: that check is the first statement in the call handler. Put it
after the dispatch and a tool handled by an earlier branch slips past it.

## Deployment knowledge is configuration

A model that has never seen your data writes IRIs it guessed and invents graph
names. Telling it your prefixes and what each graph is for fixes both, but that
knowledge belongs to a deployment, not to a package on npm.

Hence `JENA_CONTEXT_FILE`: a JSON file, rendered into the descriptions of the
SPARQL tools at listing time. The server stays generic; the specifics stay yours.

## Errors explain the status codes that mislead

`FusekiError` carries what the server actually said, plus an explanation for the
three codes whose plain meaning points the wrong way:

- **405** — usually "this dataset does not exist", not "wrong method".
- **404** on the Graph Store Protocol — "this graph is empty", which on TDB2 is
  indistinguishable from "this graph was never created".
- **401/403** — credentials, stated plainly rather than left to inference.

The body of the response is included too. Fuseki's parse errors name the line and
column; discarding them in favour of "request failed with status 400" throws away
the only useful part.
