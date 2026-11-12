import type { BindParams, Database, SqlJsStatic, Statement } from "sql.js";

let SQL: SqlJsStatic | null = null;
let saved: Uint8Array | null = null;
let current: DatabaseSync | null = null;

/** Called before the store is made: the loaded sql.js and the database saved last visit, if any */
export function useSqlJs(sql: SqlJsStatic, data: Uint8Array | null) {
  SQL = sql;
  saved = data;
}
export function exportDb(): Uint8Array | null {
  return current?.export() ?? null;
}

function toSqlValue(p: unknown) {
  if (p === undefined) {
    return null;
  }
  if (typeof p === "boolean") {
    return Number(p);
  }
  return p;
}

const bind = (params: unknown[]) => params.map(toSqlValue) as BindParams;

export class DatabaseSync {
  private db: Database;
  private cache = new Map<string, Statement>();
  constructor(_path: string) {
    if (!SQL) {
      throw new Error("sql.js isn't loaded yet");
    }
    this.db = new SQL.Database(saved ?? undefined);
    current = this;
  }
  exec(sql: string) {
    this.db.exec(sql);
  }
  private statement(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  prepare(sql: string) {
    const st = () => this.statement(sql);
    return {
      get: (...params: unknown[]) => {
        const s = st();
        try {
          s.bind(bind(params));
          return s.step() ? s.getAsObject() : undefined;
        } finally {
          s.reset();
        }
      },
      all: (...params: unknown[]) => {
        const s = st();
        const rows: Record<string, unknown>[] = [];
        try {
          s.bind(bind(params));
          while (s.step()) {
            rows.push(s.getAsObject());
          }
        } finally {
          s.reset();
        }
        return rows;
      },
      run: (...params: unknown[]) => {
        const s = st();
        try {
          s.bind(bind(params));
          s.step();
        } finally {
          s.reset();
        }
        const id = this.db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0;
        return { changes: this.db.getRowsModified(), lastInsertRowid: Number(id) };
      },
    };
  }
  /** Exports the database file. sql.js frees every prepared statement when it exports. */
  export(): Uint8Array {
    this.cache.clear();
    return this.db.export();
  }
  close() {
    this.db.close();
  }
}

export default { DatabaseSync };
