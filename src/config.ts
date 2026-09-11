/**
 * Every knob in one place.
 *
 * Settings come from the environment, with command line flags overriding them.
 * The environment is what an MCP host can set; the flags are what a human types
 * while debugging. Nothing reads `process.env` outside this file, so the set of
 * things that can change behaviour is exactly the list below.
 */

export interface Config {
  /** Base URL of the Fuseki server, without a trailing slash. */
  endpoint: string;
  /** Dataset used when a tool call does not name one. */
  dataset: string;
  username: string;
  password: string;

  /**
   * Endpoint names *under* a dataset. Fuseki's stock configuration exposes a
   * query service as both `sparql` and `query`, but a dataset that declares its
   * own endpoints in an assembler file usually has only `sparql`. Defaulting to
   * `sparql` therefore works in both cases; defaulting to `query` does not.
   */
  queryPath: string;
  updatePath: string;
  graphStorePath: string;

  /** Request timeout in milliseconds. */
  timeoutMs: number;

  /**
   * Row cap appended to a SELECT that carries no LIMIT of its own.
   *
   * This exists because exploration queries are unbounded by nature. `SELECT ?s
   * ?p ?o WHERE { ?s ?p ?o }` over a modest dataset of 1600 triples serialises
   * to roughly 630 000 characters -- about 157 000 tokens, in a single tool
   * result. Set to 0 to disable.
   */
  defaultLimit: number;

  /** Hard ceiling on the size of any tool result, in characters. */
  maxResultChars: number;

  /**
   * The only directory tools may read from or write to. Empty disables file
   * access altogether, which is the safe way to fail: a tool that "loads a
   * file" is otherwise a tool that can ship any file on the machine to a remote
   * server.
   */
  filesDir: string;

  /** Optional JSON file describing the prefixes and graphs of your project. */
  contextFile: string;

  /** When true, no tool that writes is offered or accepted. */
  readOnly: boolean;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const FLAGS: Record<string, keyof Config> = {
  '--endpoint': 'endpoint', '-e': 'endpoint',
  '--dataset': 'dataset', '-d': 'dataset',
  '--username': 'username', '-u': 'username',
  '--password': 'password', '-p': 'password',
  '--query-path': 'queryPath',
  '--update-path': 'updatePath',
  '--graph-store-path': 'graphStorePath',
  '--files-dir': 'filesDir',
  '--context-file': 'contextFile',
};

export function loadConfig(argv: string[] = process.argv.slice(2)): Config {
  const env = process.env;
  const config: Config = {
    endpoint: (env.JENA_ENDPOINT || env.FUSEKI_URL || 'http://localhost:3030').replace(/\/+$/, ''),
    dataset: env.JENA_DATASET || 'ds',
    username: env.JENA_USERNAME || '',
    password: env.JENA_PASSWORD || '',
    queryPath: env.JENA_QUERY_PATH || 'sparql',
    updatePath: env.JENA_UPDATE_PATH || 'update',
    graphStorePath: env.JENA_GRAPH_STORE_PATH || 'data',
    timeoutMs: num(env.JENA_TIMEOUT_MS, 60_000),
    defaultLimit: num(env.JENA_DEFAULT_LIMIT, 1000),
    maxResultChars: num(env.JENA_MAX_RESULT_CHARS, 100_000),
    filesDir: env.JENA_FILES_DIR || '',
    contextFile: env.JENA_CONTEXT_FILE || '',
    readOnly: bool(env.JENA_READ_ONLY),
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--read-only') { config.readOnly = true; continue; }
    const key = FLAGS[flag];
    if (key && i + 1 < argv.length) {
      (config as unknown as Record<string, unknown>)[key] = argv[++i]!;
    }
  }

  config.endpoint = config.endpoint.replace(/\/+$/, '');
  return config;
}

/** A one-line summary for the startup banner. Never logs the password. */
export function describe(config: Config): string {
  const bits = [
    `endpoint=${config.endpoint}`,
    `dataset=${config.dataset}`,
    config.username ? `user=${config.username}` : 'anonymous',
    `limit=${config.defaultLimit || 'off'}`,
    `maxChars=${config.maxResultChars}`,
  ];
  if (config.readOnly) bits.push('READ-ONLY');
  if (config.filesDir) bits.push(`files=${config.filesDir}`);
  return bits.join(' ');
}
