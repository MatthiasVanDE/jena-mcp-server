/**
 * The HTTP surface of Apache Jena Fuseki.
 *
 * Three protocols live behind one server, and this client keeps them apart:
 *
 *   SPARQL Protocol         /<dataset>/sparql, /<dataset>/update
 *   Graph Store Protocol    /<dataset>/data?graph=...
 *   Fuseki administration   /$/datasets, /$/backup, /$/compact, /$/tasks
 *
 * Built on the platform's own fetch, so the package has exactly one runtime
 * dependency: the MCP SDK.
 */

import type { Config } from './config.js';
import { acceptFor, withRowLimit } from './sparql.js';

/** A SPARQL SELECT/ASK result in the standard JSON shape. */
export interface SparqlJson {
  head: { vars?: string[]; link?: string[] };
  results?: { bindings: Record<string, SparqlTerm>[] };
  boolean?: boolean;
}

export interface SparqlTerm {
  type: 'uri' | 'literal' | 'bnode';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

/** Raised for any non-2xx answer, carrying what the server actually said. */
export class FusekiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(message);
    this.name = 'FusekiError';
  }

  /**
   * The status codes worth explaining, because their plain meaning misleads.
   */
  override toString(): string {
    const lines = [`${this.message}`];
    if (this.body.trim()) lines.push('', this.body.trim().slice(0, 2000));

    if (this.status === 401 || this.status === 403) {
      lines.push('', 'Authentication failed. Check JENA_USERNAME and JENA_PASSWORD.');
    }
    if (this.status === 404) {
      lines.push(
        '',
        'A 404 on the Graph Store Protocol means the graph holds no triples.',
        'In TDB2 an empty graph and a missing graph are the same thing.',
      );
    }
    if (this.status === 405) {
      lines.push(
        '',
        'A 405 usually means the dataset does not exist -- Fuseki answers 405 rather',
        'than 404 for an unknown dataset name. It can also mean the endpoint path is',
        'wrong: a query goes to /<dataset>/sparql, an update to /<dataset>/update.',
        'Call list_datasets to see what exists and which endpoints it offers.',
      );
    }
    if (this.status === 406) {
      lines.push('', 'The server cannot produce the requested media type for this query form.');
    }
    return lines.join('\n');
  }
}

export class FusekiClient {
  constructor(private readonly config: Config) {}

  /** Base URL of one dataset. */
  private datasetUrl(dataset?: string): string {
    return `${this.config.endpoint}/${dataset || this.config.dataset}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.config.username) {
      const token = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    }
    return headers;
  }

  private async request(url: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
    const { accept, ...rest } = init;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        ...rest,
        signal: controller.signal,
        headers: this.headers({
          ...(accept ? { Accept: accept } : {}),
          ...(rest.headers as Record<string, string> | undefined),
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new FusekiError(
          `${init.method ?? 'GET'} ${url} returned ${response.status} ${response.statusText}`,
          response.status, body, url,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof FusekiError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new FusekiError(
          `Request timed out after ${this.config.timeoutMs} ms: ${url}`, 0, '', url,
        );
      }
      throw new FusekiError(`Request failed: ${(error as Error).message}`, 0, '', url);
    } finally {
      clearTimeout(timer);
    }
  }

  // -- SPARQL Protocol -----------------------------------------------------

  /**
   * Runs a read query. POST rather than GET: building a graph takes queries far
   * longer than a URL may be, and a GET would fail on length alone.
   */
  async query(
    sparql: string,
    options: { dataset?: string; limit?: number; accept?: string } = {},
  ): Promise<{ body: string; contentType: string; applied: string }> {
    const limit = options.limit ?? this.config.defaultLimit;
    const applied = withRowLimit(sparql, limit);
    const url = `${this.datasetUrl(options.dataset)}/${this.config.queryPath}`;
    const response = await this.request(url, {
      method: 'POST',
      accept: acceptFor(applied, options.accept),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query: applied }).toString(),
    });
    return {
      body: await response.text(),
      contentType: response.headers.get('content-type') ?? '',
      applied,
    };
  }

  /** Runs a read query and parses the standard JSON result. */
  async queryJson(sparql: string, options: { dataset?: string; limit?: number } = {}): Promise<SparqlJson> {
    const { body } = await this.query(sparql, { ...options, accept: 'application/sparql-results+json' });
    return JSON.parse(body) as SparqlJson;
  }

  /** Convenience for a query whose first binding is a single number. */
  async count(sparql: string, dataset?: string): Promise<number> {
    const json = await this.queryJson(sparql, { dataset, limit: 0 });
    const first = json.results?.bindings?.[0];
    const value = first ? Object.values(first)[0]?.value : undefined;
    return value === undefined ? 0 : Number(value);
  }

  async update(sparql: string, dataset?: string): Promise<void> {
    const url = `${this.datasetUrl(dataset)}/${this.config.updatePath}`;
    await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ update: sparql }).toString(),
    });
  }

  // -- Graph Store Protocol ------------------------------------------------

  private graphUrl(graph: string | undefined, dataset?: string): string {
    const base = `${this.datasetUrl(dataset)}/${this.config.graphStorePath}`;
    return graph ? `${base}?${new URLSearchParams({ graph })}` : `${base}?default`;
  }

  /** Fetches one graph whole. One request, no query parser involved. */
  async readGraph(graph: string | undefined, options: { dataset?: string; accept?: string } = {}): Promise<string> {
    const response = await this.request(this.graphUrl(graph, options.dataset), {
      method: 'GET',
      accept: options.accept ?? 'text/turtle',
    });
    return response.text();
  }

  /**
   * Writes one graph. `mode: 'replace'` is a PUT -- the graph becomes exactly
   * this content -- and `'merge'` is a POST, which adds to what is there.
   */
  async writeGraph(
    content: string | Buffer,
    options: { graph?: string; dataset?: string; mode?: 'replace' | 'merge'; contentType?: string } = {},
  ): Promise<number> {
    const response = await this.request(this.graphUrl(options.graph, options.dataset), {
      method: options.mode === 'merge' ? 'POST' : 'PUT',
      headers: { 'Content-Type': options.contentType ?? 'text/turtle' },
      body: content as string | Uint8Array,
    });
    return response.status;
  }

  async dropGraph(graph: string, dataset?: string): Promise<number> {
    const response = await this.request(this.graphUrl(graph, dataset), { method: 'DELETE' });
    return response.status;
  }

  // -- Administration ------------------------------------------------------

  private async admin(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.request(`${this.config.endpoint}/$/${path}`, {
      accept: 'application/json', ...init,
    });
    const text = await response.text();
    if (!text.trim()) return { ok: true };
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  async datasets(): Promise<DatasetInfo[]> {
    const data = (await this.admin('datasets')) as { datasets?: RawDataset[] };
    return (data.datasets ?? []).map(toDatasetInfo);
  }

  async serverInfo(): Promise<unknown> {
    return this.admin('server');
  }

  async stats(dataset?: string): Promise<unknown> {
    return this.admin(dataset ? `stats/${dataset}` : 'stats');
  }

  /** Creates a dataset. `kind` is Fuseki's dbType: tdb2, tdb or mem. */
  async createDataset(name: string, kind: 'tdb2' | 'tdb' | 'mem' = 'tdb2'): Promise<unknown> {
    return this.admin('datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ dbName: name, dbType: kind }).toString(),
    });
  }

  /**
   * Removes a dataset from the server *and* deletes its files.
   *
   * Fuseki's own wording for this endpoint is "remove"; the data on disk goes
   * with it. There is no undo.
   */
  async deleteDataset(name: string): Promise<unknown> {
    return this.admin(`datasets/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  async backup(dataset?: string): Promise<unknown> {
    return this.admin(`backup/${dataset || this.config.dataset}`, { method: 'POST' });
  }

  async compact(dataset?: string, deleteOld = false): Promise<unknown> {
    const name = dataset || this.config.dataset;
    const suffix = deleteOld ? '?deleteOld=true' : '';
    return this.admin(`compact/${name}${suffix}`, { method: 'POST' });
  }

  async task(id: string): Promise<unknown> {
    return this.admin(`tasks/${encodeURIComponent(id)}`);
  }

  async ping(): Promise<string> {
    const response = await this.request(`${this.config.endpoint}/$/ping`, { method: 'GET' });
    return response.text();
  }
}

interface RawDataset {
  'ds.name'?: string;
  'ds.state'?: boolean;
  'ds.services'?: { 'srv.type'?: string; 'srv.endpoints'?: string[] }[];
}

export interface DatasetInfo {
  name: string;
  active: boolean;
  endpoints: Record<string, string[]>;
}

function toDatasetInfo(raw: RawDataset): DatasetInfo {
  return {
    name: (raw['ds.name'] ?? '').replace(/^\//, ''),
    active: raw['ds.state'] ?? false,
    endpoints: Object.fromEntries(
      (raw['ds.services'] ?? []).map((s) => [s['srv.type'] ?? '?', s['srv.endpoints'] ?? []]),
    ),
  };
}
