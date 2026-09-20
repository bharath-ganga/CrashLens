import {
  createClient,
  type Client,
  type InValue,
} from '@tursodatabase/serverless/compat';
import { normalizeDatabaseRow } from './rows';

export type DatabaseValue =
  | ArrayBuffer
  | Uint8Array
  | bigint
  | boolean
  | number
  | string
  | null
  | undefined;

export type DatabaseResult<T = Record<string, unknown>> = {
  results: T[];
  success: true;
  meta: {
    changes: number;
    duration: number;
    last_row_id: number | null;
    rows_read: number;
    rows_written: number;
  };
};

export interface DatabaseStatement {
  bind(...values: DatabaseValue[]): DatabaseStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
}

export interface Database {
  prepare(sql: string): DatabaseStatement;
  batch<T = Record<string, unknown>>(
    statements: DatabaseStatement[],
  ): Promise<DatabaseResult<T>[]>;
}

type BoundStatement = DatabaseStatement & {
  readonly sql: string;
  readonly args: InValue[];
};

function normalizeValue(value: DatabaseValue): InValue {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function toResult<T>(result: {
  columns: string[];
  rows: unknown[];
  rowsAffected: number;
  lastInsertRowid?: bigint;
}): DatabaseResult<T> {
  const rows = result.rows.map((row) =>
    normalizeDatabaseRow(result.columns, row),
  );
  return {
    results: rows as T[],
    success: true,
    meta: {
      changes: result.rowsAffected,
      duration: 0,
      last_row_id:
        result.lastInsertRowid === undefined
          ? null
          : Number(result.lastInsertRowid),
      rows_read: rows.length,
      rows_written: result.rowsAffected,
    },
  };
}

class TursoStatement implements BoundStatement {
  readonly args: InValue[];

  constructor(
    private readonly client: Client,
    readonly sql: string,
    args: InValue[] = [],
  ) {
    this.args = args;
  }

  bind(...values: DatabaseValue[]): DatabaseStatement {
    return new TursoStatement(
      this.client,
      this.sql,
      values.map(normalizeValue),
    );
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.client.execute({
      sql: this.sql,
      args: this.args,
    });
    const row = result.rows[0];
    if (!row) return null;
    if (column !== undefined) return (row[column] ?? null) as T | null;
    return normalizeDatabaseRow(result.columns, row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    return toResult<T>(
      await this.client.execute({ sql: this.sql, args: this.args }),
    );
  }

  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    return this.all<T>();
  }
}

class TursoDatabase implements Database {
  constructor(private readonly client: Client) {}

  prepare(sql: string): DatabaseStatement {
    return new TursoStatement(this.client, sql);
  }

  async batch<T = Record<string, unknown>>(
    statements: DatabaseStatement[],
  ): Promise<DatabaseResult<T>[]> {
    const bound = statements as BoundStatement[];
    const results = await this.client.batch(
      bound.map(({ sql, args }) => ({ sql, args })),
      'write',
    );
    return results.map((result) => toResult<T>(result));
  }
}

export function createDatabase(url: string, authToken: string): Database {
  const client = createClient({ url, authToken });
  return new TursoDatabase(client);
}
