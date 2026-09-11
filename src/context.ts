/**
 * Optional knowledge about *your* graph, kept out of the source.
 *
 * A model that has never seen your data writes `<urn:long:iri:you:have:to:guess>`
 * where you would write `ex:thing`, and drops triples into whichever graph it
 * invented. Both are fixable by telling it, once, what the prefixes are and what
 * each named graph is for.
 *
 * That knowledge belongs to a deployment, not to this package, so it lives in a
 * JSON file pointed at by JENA_CONTEXT_FILE. Without one the server is simply
 * generic.
 */

import { readFileSync } from 'node:fs';

export interface GraphNote {
  iri: string;
  purpose?: string;
  writtenBy?: string;
  /** 'static' graphs are replaced wholesale; 'dynamic' ones accumulate. */
  kind?: 'static' | 'dynamic' | string;
}

export interface ProjectContext {
  prefixes?: Record<string, string>;
  graphs?: GraphNote[];
  notes?: string;
}

export function loadContext(path: string): ProjectContext {
  if (!path) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ProjectContext;
    return parsed ?? {};
  } catch (error) {
    // stderr, never stdout: stdout carries the JSON-RPC stream.
    console.error(`[jena-mcp-server] context file unreadable (${path}): ${(error as Error).message}`);
    return {};
  }
}

/** Renders the context as a block appended to the SPARQL tool descriptions. */
export function renderContext(context: ProjectContext): string {
  const sections: string[] = [];

  if (context.prefixes && Object.keys(context.prefixes).length > 0) {
    const lines = Object.entries(context.prefixes).map(([p, iri]) => `  PREFIX ${p}: <${iri}>`);
    sections.push(`Prefixes in use here -- prefer these over full IRIs:\n${lines.join('\n')}`);
  }

  if (context.graphs && context.graphs.length > 0) {
    const lines = context.graphs.map((g) => {
      const bits = [`  <${g.iri}>`];
      if (g.purpose) bits.push(`\n      ${g.purpose}`);
      if (g.kind) bits.push(`\n      (${g.kind}${g.writtenBy ? `, written by ${g.writtenBy}` : ''})`);
      else if (g.writtenBy) bits.push(`\n      (written by ${g.writtenBy})`);
      return bits.join('');
    });
    sections.push(`Named graphs in this dataset and what belongs in each:\n${lines.join('\n')}`);
  }

  if (context.notes) sections.push(context.notes);

  return sections.length === 0 ? '' : `\n\n### This deployment\n\n${sections.join('\n\n')}`;
}
