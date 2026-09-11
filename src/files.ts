/**
 * File access, fenced off.
 *
 * A tool that "loads a file into the triplestore" is, without a fence, a tool
 * that can ship any readable file on the machine to a remote server. So the
 * fence is not a nicety: `filesDir` is the only directory that may be read from
 * or written to, and leaving it unset disables file access entirely.
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, extname } from 'node:path';
import type { Config } from './config.js';

export class FileAccessError extends Error {}

/**
 * Resolves a caller-supplied path inside the sandbox, or refuses.
 *
 * Relative paths resolve against the sandbox root; absolute paths must already
 * be inside it. Both are checked *after* resolution, so `..` segments and
 * symlink-free traversal cannot escape.
 */
export function resolveInSandbox(config: Config, path: string): string {
  if (!config.filesDir) {
    throw new FileAccessError(
      'File access is disabled. Set JENA_FILES_DIR (or --files-dir) to the directory ' +
      'that tools may read from and write to, then restart the server.',
    );
  }
  if (!path || typeof path !== 'string') {
    throw new FileAccessError('No path given.');
  }

  const root = resolve(config.filesDir);
  const target = resolve(isAbsolute(path) ? path : `${root}/${path}`);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new FileAccessError(`Path is outside the sandbox (${root}): ${path}`);
  }
  return target;
}

export function readText(config: Config, path: string): { text: string; path: string; bytes: number } {
  const target = resolveInSandbox(config, path);
  let stat;
  try {
    stat = statSync(target);
  } catch {
    throw new FileAccessError(`No such file: ${target}`);
  }
  if (!stat.isFile()) throw new FileAccessError(`Not a regular file: ${target}`);
  return { text: readFileSync(target, 'utf8'), path: target, bytes: stat.size };
}

export function writeText(config: Config, path: string, text: string): { path: string; bytes: number } {
  const target = resolveInSandbox(config, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
  return { path: target, bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * The RDF media type for a filename.
 *
 * Getting this wrong is not a detail: Fuseki parses what the Content-Type says
 * it is, so a TriG file announced as Turtle fails on its first graph block.
 */
const MEDIA_TYPES: Record<string, string> = {
  '.ttl': 'text/turtle',
  '.turtle': 'text/turtle',
  '.n3': 'text/n3',
  '.nt': 'application/n-triples',
  '.trig': 'application/trig',
  '.nq': 'application/n-quads',
  '.jsonld': 'application/ld+json',
  '.json': 'application/ld+json',
  '.rdf': 'application/rdf+xml',
  '.owl': 'application/rdf+xml',
  '.xml': 'application/rdf+xml',
};

export function mediaTypeFor(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'text/turtle';
}

/** True when the format carries its own graph names, so a target graph is wrong. */
export function isQuadFormat(path: string): boolean {
  const type = mediaTypeFor(path);
  return type === 'application/trig' || type === 'application/n-quads';
}
