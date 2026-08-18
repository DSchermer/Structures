// Cloudflare D1 / Worker binding types.

export interface D1Result<T> { results?: T[]; }

export interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement;
  first: <T = unknown>(col?: string) => Promise<T | null>;
  all: <T = unknown>() => Promise<D1Result<T>>;
  run: () => Promise<{ success: boolean }>;
}

export interface D1Database {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
}

export interface Fetcher { fetch: (request: Request) => Promise<Response>; }

export interface Env { DB: D1Database; ASSETS: Fetcher; }
