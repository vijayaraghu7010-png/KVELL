import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// node:sqlite prints an ExperimentalWarning on first import; it is stable enough for this app's use
// (synchronous, single-process) and keeps the project free of native build dependencies.

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, any>;

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export class Database {
  readonly raw: DatabaseSync;
  readonly file: string;
  private txDepth = 0;

  constructor(file: string) {
    this.file = file;
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    }
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') {
      this.raw.exec('PRAGMA journal_mode = WAL;');
    }
  }

  private params(values: unknown[]): SqlValue[] {
    return values.map((v) => {
      if (v === undefined) return null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v as SqlValue;
    });
  }

  get<T = Row>(sql: string, ...values: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...this.params(values)) as T | undefined;
  }

  all<T = Row>(sql: string, ...values: unknown[]): T[] {
    return this.raw.prepare(sql).all(...this.params(values)) as T[];
  }

  run(sql: string, ...values: unknown[]): { changes: number; lastInsertRowid: number } {
    const res = this.raw.prepare(sql).run(...this.params(values));
    return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
  }

  /** Runs fn atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  /** Applies pending migrations in filename order. Never drops or rewrites applied migrations. */
  migrate(): string[] {
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);
    const applied = new Set(this.all<{ version: string }>('SELECT version FROM schema_migrations').map((r) => r.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const newlyApplied: string[] = [];
    // Foreign keys are disabled for the duration of a migration so that the documented
    // SQLite table-rebuild procedure (create new, copy, drop old, rename) is possible;
    // every migration is verified with foreign_key_check before it commits.
    this.raw.exec('PRAGMA foreign_keys = OFF;');
    try {
      for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (applied.has(version)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        this.transaction(() => {
          this.raw.exec(sql);
          const violations = this.all<any>('PRAGMA foreign_key_check');
          if (violations.length) throw new Error(`Migration ${version} left ${violations.length} foreign key violation(s): ${JSON.stringify(violations.slice(0, 5))}`);
          this.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, new Date().toISOString());
        });
        newlyApplied.push(version);
      }
    } finally {
      this.raw.exec('PRAGMA foreign_keys = ON;');
    }
    return newlyApplied;
  }

  close() {
    this.raw.close();
  }
}

let instance: Database | null = null;

export function openDatabase(file = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'kvcet.db')): Database {
  const db = new Database(file);
  db.migrate();
  return db;
}

/** Process-wide database handle. Tests replace it with setDatabase(). */
export function db(): Database {
  if (!instance) instance = openDatabase();
  return instance;
}

export function setDatabase(next: Database) {
  instance = next;
}
