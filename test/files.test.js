/** The sandbox: what it lets through, and what it must not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInSandbox, readText, mediaTypeFor, isQuadFormat, FileAccessError } from '../dist/files.js';

const root = mkdtempSync(join(tmpdir(), 'jena-mcp-'));
mkdirSync(join(root, 'sub'), { recursive: true });
writeFileSync(join(root, 'ok.ttl'), '<urn:a> <urn:b> "c" .\n');
writeFileSync(join(root, 'sub', 'deep.ttl'), '<urn:d> <urn:e> "f" .\n');
const config = { filesDir: root };

test('resolves paths inside the sandbox', () => {
  assert.equal(resolveInSandbox(config, 'ok.ttl'), join(root, 'ok.ttl'));
  assert.equal(resolveInSandbox(config, 'sub/deep.ttl'), join(root, 'sub', 'deep.ttl'));
  assert.equal(resolveInSandbox(config, join(root, 'ok.ttl')), join(root, 'ok.ttl'));
});

test('refuses to climb out of it', () => {
  for (const escape of ['../outside.ttl', 'sub/../../outside.ttl', '/etc/hosts', '../../../../etc/passwd']) {
    assert.throws(() => resolveInSandbox(config, escape), FileAccessError, escape);
  }
});

test('refuses everything when no sandbox is configured', () => {
  assert.throws(() => resolveInSandbox({ filesDir: '' }, 'ok.ttl'), FileAccessError);
});

test('reads a file that is inside', () => {
  const read = readText(config, 'ok.ttl');
  assert.match(read.text, /urn:a/);
  assert.ok(read.bytes > 0);
});

test('reports a missing file as such', () => {
  assert.throws(() => readText(config, 'nope.ttl'), /No such file/);
});

test('maps extensions to the media types Fuseki parses by', () => {
  assert.equal(mediaTypeFor('a.ttl'), 'text/turtle');
  assert.equal(mediaTypeFor('a.TTL'), 'text/turtle');
  assert.equal(mediaTypeFor('a.trig'), 'application/trig');
  assert.equal(mediaTypeFor('a.nq'), 'application/n-quads');
  assert.equal(mediaTypeFor('a.jsonld'), 'application/ld+json');
  assert.equal(mediaTypeFor('a.unknown'), 'text/turtle');
});

test('knows which formats carry their own graph names', () => {
  assert.equal(isQuadFormat('a.trig'), true);
  assert.equal(isQuadFormat('a.nq'), true);
  assert.equal(isQuadFormat('a.ttl'), false);
});
