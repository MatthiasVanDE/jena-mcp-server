/**
 * The two decisions that have to be right before a request leaves: which form
 * the SPARQL is, and whether a row cap may be appended.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { queryForm, isReadQuery, acceptFor, withRowLimit, complaints } from '../dist/sparql.js';

test('recognises the four query forms', () => {
  assert.equal(queryForm('SELECT ?s WHERE { ?s ?p ?o }'), 'SELECT');
  assert.equal(queryForm('construct { ?s ?p ?o } where { ?s ?p ?o }'), 'CONSTRUCT');
  assert.equal(queryForm('ASK { ?s ?p ?o }'), 'ASK');
  assert.equal(queryForm('DESCRIBE <urn:a>'), 'DESCRIBE');
});

test('treats every update keyword as an update', () => {
  for (const keyword of ['INSERT DATA { <a> <b> <c> }', 'DELETE WHERE { ?s ?p ?o }',
                         'CREATE GRAPH <urn:g>', 'DROP GRAPH <urn:g>', 'CLEAR DEFAULT',
                         'LOAD <http://x/f.ttl>', 'COPY <urn:a> TO <urn:b>',
                         'MOVE <urn:a> TO <urn:b>', 'ADD <urn:a> TO <urn:b>',
                         'WITH <urn:g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }']) {
    assert.equal(queryForm(keyword), 'UPDATE', keyword);
    assert.equal(isReadQuery(keyword), false, keyword);
  }
});

test('the FIRST keyword decides, not any keyword', () => {
  // A sub-SELECT inside a CONSTRUCT must not make it a SELECT: the Accept
  // header would then be wrong and the server answers 406.
  const nested = 'CONSTRUCT { ?s ?p ?o } WHERE { { SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 2 } }';
  assert.equal(queryForm(nested), 'CONSTRUCT');
  assert.equal(acceptFor(nested), 'text/turtle');
});

test('keywords inside IRIs, comments and literals do not count', () => {
  assert.equal(queryForm('PREFIX ex: <http://example.org/select>\nASK { ?s ?p ?o }'), 'ASK');
  assert.equal(queryForm('# SELECT is mentioned here\nASK { ?s ?p ?o }'), 'ASK');
  assert.equal(queryForm('ASK { ?s ?p "a DELETE in a string" }'), 'ASK');
});

test('the row cap goes on a bare SELECT and nowhere else', () => {
  assert.match(withRowLimit('SELECT ?s { ?s ?p ?o }', 100), /LIMIT 100$/);
  assert.equal(withRowLimit('SELECT ?s { ?s ?p ?o } LIMIT 5', 100), 'SELECT ?s { ?s ?p ?o } LIMIT 5');
  assert.equal(withRowLimit('ASK { ?s ?p ?o }', 100), 'ASK { ?s ?p ?o }');
  // On CONSTRUCT a LIMIT would quietly change which triples come back.
  const c = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';
  assert.equal(withRowLimit(c, 100), c);
  assert.equal(withRowLimit('SELECT ?s { ?s ?p ?o }', 0), 'SELECT ?s { ?s ?p ?o }');
});

test('accepts valid SPARQL that naive checks reject', () => {
  // WHERE is optional, and FILTER needs a group pattern, not the word WHERE.
  assert.deepEqual(complaints('SELECT ?s { ?s ?p ?o }'), []);
  assert.deepEqual(complaints('SELECT ?s { ?s ?p ?o FILTER(isIRI(?s)) }'), []);
});

test('catches the mistakes worth catching locally', () => {
  assert.equal(complaints('').length, 1);
  assert.match(complaints('SELECT ?s { ?s ?p ?o')[0].message, /brace/i);
  assert.match(
    complaints('PREFIX ex: <http://example.org/> .\nSELECT ?s { ?s ?p ?o }')[0].message,
    /must not end with a dot/i,
  );
  assert.match(complaints('this is not sparql at all')[0].message, /No SPARQL keyword/i);
});

test('a hash inside an IRI is not a comment', () => {
  // Hash namespaces are the common case -- urn:example:graph#schema, and every
  // OWL vocabulary. Treating that # as a line comment swallows the rest of the
  // statement, braces included, and the query is rejected before it is sent.
  const update = 'INSERT DATA { GRAPH <urn:example:graph#part> { <urn:s> <urn:p> "o" } }';
  assert.deepEqual(complaints(update), []);
  assert.equal(queryForm(update), 'UPDATE');

  const query = 'SELECT ?s WHERE { GRAPH <urn:example:graph#part> { ?s ?p ?o } }';
  assert.deepEqual(complaints(query), []);
  assert.equal(queryForm(query), 'SELECT');
});

test('a real comment is still a comment', () => {
  assert.deepEqual(complaints('# DROP GRAPH <urn:x>\nSELECT ?s { ?s ?p ?o }'), []);
  assert.equal(queryForm('# DROP GRAPH <urn:x>\nSELECT ?s { ?s ?p ?o }'), 'SELECT');
  // An unbalanced brace hidden in a comment must not be counted.
  assert.deepEqual(complaints('SELECT ?s { ?s ?p ?o } # trailing { brace'), []);
});
