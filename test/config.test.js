/** Settings: the defaults, and flags winning over the environment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, describe } from '../dist/config.js';

test('sensible defaults', () => {
  const c = loadConfig([]);
  assert.equal(c.endpoint, 'http://localhost:3030');
  // 'sparql' and not 'query': a dataset that declares its own endpoints
  // usually offers only the former, and stock Fuseki offers both.
  assert.equal(c.queryPath, 'sparql');
  assert.equal(c.graphStorePath, 'data');
  assert.equal(c.defaultLimit, 1000);
  assert.equal(c.readOnly, false);
  assert.equal(c.filesDir, '');
});

test('flags override, and trailing slashes go', () => {
  const c = loadConfig(['--endpoint', 'http://example.org:3030/', '-d', 'kb', '--read-only']);
  assert.equal(c.endpoint, 'http://example.org:3030');
  assert.equal(c.dataset, 'kb');
  assert.equal(c.readOnly, true);
});

test('the banner never contains the password', () => {
  const c = loadConfig(['-u', 'admin', '-p', 'hunter2']);
  const line = describe(c);
  assert.ok(!line.includes('hunter2'));
  assert.ok(line.includes('admin'));
});
