/**
 * Reading a SPARQL string well enough to route it correctly.
 *
 * This is deliberately not a parser. Fuseki has one, and it reports better
 * errors than anything reimplemented here would. What this module does is
 * answer two questions that have to be answered *before* the request is sent:
 * which result format to ask for, and whether a row cap can safely be appended.
 */

export type QueryForm =
  | 'SELECT' | 'CONSTRUCT' | 'ASK' | 'DESCRIBE'
  | 'UPDATE'   // INSERT, DELETE, LOAD, CLEAR, CREATE, DROP, COPY, MOVE, ADD, WITH
  | 'UNKNOWN';

const QUERY_FORMS = ['SELECT', 'CONSTRUCT', 'ASK', 'DESCRIBE'] as const;
const UPDATE_FORMS = [
  'INSERT', 'DELETE', 'LOAD', 'CLEAR', 'CREATE', 'DROP', 'COPY', 'MOVE', 'ADD', 'WITH',
] as const;

/**
 * Blanks out everything that may look like code but is not: string literals,
 * IRIs and comments.
 *
 * Without it, `PREFIX ex: <http://example.org/select>` makes a CONSTRUCT look
 * like a SELECT, and the wrong Accept header earns a 406 from the server.
 *
 * ONE pass, not three chained replaces, and the order of the alternatives is
 * the whole point. A `#` inside an IRI -- <urn:example:graph#schema>, the shape
 * every hash namespace has -- is not a comment, but a comment-first pass reads
 * it as one and swallows the rest of the line, braces and all. Matching IRIs
 * and literals before comments means whichever starts first wins, which is what
 * a tokeniser would do.
 */
const NON_CODE =
  /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^>\s]*>|#[^\n]*/g;

function stripNonCode(sparql: string): string {
  return sparql.replace(NON_CODE, ' ');
}

/**
 * The form of a SPARQL string, taken from the first keyword that is actually a
 * keyword -- not from whether a word appears somewhere.
 */
export function queryForm(sparql: string): QueryForm {
  const code = stripNonCode(sparql);
  const match = code.match(
    /\b(SELECT|CONSTRUCT|ASK|DESCRIBE|INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD|WITH)\b/i,
  );
  if (!match) return 'UNKNOWN';
  const word = match[1]!.toUpperCase();
  if ((QUERY_FORMS as readonly string[]).includes(word)) return word as QueryForm;
  if ((UPDATE_FORMS as readonly string[]).includes(word)) return 'UPDATE';
  return 'UNKNOWN';
}

/** True when the string is a read-only query rather than an update. */
export function isReadQuery(sparql: string): boolean {
  const form = queryForm(sparql);
  return form === 'SELECT' || form === 'CONSTRUCT' || form === 'ASK' || form === 'DESCRIBE';
}

/** The media type to ask for, given what the query will return. */
export function acceptFor(sparql: string, preferred?: string): string {
  if (preferred) return preferred;
  const form = queryForm(sparql);
  if (form === 'CONSTRUCT' || form === 'DESCRIBE') return 'text/turtle';
  return 'application/sparql-results+json';
}

/**
 * Appends `LIMIT n` to a SELECT that does not set its own.
 *
 * Only SELECT: on ASK it is meaningless, and on CONSTRUCT or DESCRIBE it would
 * silently change which triples come back. A query that already carries a LIMIT
 * keeps it -- the caller's intent wins over the default.
 */
export function withRowLimit(sparql: string, limit: number): string {
  if (!limit || limit <= 0) return sparql;
  const code = stripNonCode(sparql);
  if (queryForm(sparql) !== 'SELECT') return sparql;
  if (/\bLIMIT\s+\d+/i.test(code)) return sparql;
  return `${sparql.trimEnd()}\nLIMIT ${limit}`;
}

export interface Complaint {
  message: string;
  hint?: string;
}

/**
 * The few mistakes worth catching before a round trip.
 *
 * Everything here is something Fuseki would reject too, but where the local
 * message is more useful than the parse error. Anything ambiguous is left to
 * the server: a client-side validator that refuses valid SPARQL is worse than
 * no validator, and `SELECT ?s { ?s ?p ?o }` -- WHERE is optional -- is exactly
 * the kind of query that trips naive checks.
 */
export function complaints(sparql: string): Complaint[] {
  const found: Complaint[] = [];
  const text = sparql.trim();

  if (!text) {
    found.push({ message: 'The query is empty.' });
    return found;
  }

  if (queryForm(text) === 'UNKNOWN') {
    found.push({
      message: 'No SPARQL keyword found.',
      hint: 'A query starts with SELECT, CONSTRUCT, ASK or DESCRIBE; an update with INSERT, DELETE, LOAD, CLEAR, CREATE, DROP, COPY, MOVE or ADD.',
    });
  }

  const code = stripNonCode(text);
  const opens = (code.match(/{/g) ?? []).length;
  const closes = (code.match(/}/g) ?? []).length;
  if (opens !== closes) {
    found.push({
      message: `Unbalanced braces: ${opens} "{" against ${closes} "}".`,
      hint: 'Count from the outermost group inward; a missing closing brace usually sits at the end of a nested OPTIONAL or GRAPH block.',
    });
  }

  const parensOpen = (code.match(/\(/g) ?? []).length;
  const parensClose = (code.match(/\)/g) ?? []).length;
  if (parensOpen !== parensClose) {
    found.push({ message: `Unbalanced parentheses: ${parensOpen} "(" against ${parensClose} ")".` });
  }

  // A trailing dot after PREFIX is Turtle syntax. In SPARQL it is an error, and
  // it is a common enough slip that naming it saves a round trip.
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (/^PREFIX\b/i.test(trimmed) && trimmed.endsWith('.')) {
      found.push({
        message: 'A PREFIX declaration must not end with a dot.',
        hint: 'That is Turtle. In SPARQL write: PREFIX ex: <http://example.org/>',
      });
      break;
    }
  }

  return found;
}

/** Formats complaints for a tool result. */
export function complaintText(list: Complaint[]): string {
  return list
    .map((c, i) => `${i + 1}. ${c.message}${c.hint ? `\n   ${c.hint}` : ''}`)
    .join('\n');
}
