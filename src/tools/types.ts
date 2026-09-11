/**
 * What a tool is, in this server.
 *
 * Each tool is a small object with its schema and its implementation together,
 * registered in one list. The alternative -- a switch over tool names with the
 * schemas declared somewhere else -- drifts: a parameter gets added to the
 * schema and not to the handler, and nothing notices.
 */

import type { Config } from '../config.js';
import type { FusekiClient } from '../fuseki.js';
import type { ProjectContext } from '../context.js';

export interface ToolContext {
  config: Config;
  client: FusekiClient;
  project: ProjectContext;
  /** Truncates anything that would swamp the caller's context window. */
  cap(text: string, what?: string): string;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Writing tools are hidden and refused when the server runs read-only. */
  writes: boolean;
  /** Whether the deployment's prefixes and graph notes are worth appending. */
  wantsProjectContext?: boolean;
  run(args: Record<string, any>, ctx: ToolContext): Promise<string>;
}

/** Shorthand for a required string argument, with a clear failure. */
export function requireString(args: Record<string, any>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required argument "${key}".`);
  }
  return value;
}
