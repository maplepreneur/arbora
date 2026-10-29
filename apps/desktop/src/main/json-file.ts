import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runMigrations, type MigrationTable } from '@arbora/shared';
import type { z } from 'zod';

export type LoadStatus = 'missing' | 'current' | 'migrated' | 'too-new' | 'invalid-json';

export interface LoadResult<T> {
  readonly value: T;
  readonly status: LoadStatus;
  /** False when writing would destroy data: a newer version's file, or one with a syntax error. */
  readonly writable: boolean;
}

export interface VersionedJsonFileOptions<T> {
  readonly path: string;
  readonly version: number;
  readonly schema: z.ZodType<T>;
  readonly migrations: MigrationTable;
}

/**
 * A small JSON document on disk with a `version` field, a migrations table and a zod schema that
 * supplies defaults. Reads are synchronous (tiny files, needed before the first window); writes
 * are atomic (temp file + rename) and serialised.
 */
export class VersionedJsonFile<T> {
  readonly path: string;
  readonly #options: VersionedJsonFileOptions<T>;
  #writeChain: Promise<void> = Promise.resolve();
  #lastWritten: string | undefined;

  constructor(options: VersionedJsonFileOptions<T>) {
    this.path = options.path;
    this.#options = options;
  }

  load(): LoadResult<T> {
    const { schema, version, migrations } = this.#options;
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        return { value: schema.parse({}), status: 'missing', writable: true };
      }
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { value: schema.parse({}), status: 'invalid-json', writable: false };
    }
    const migrated = runMigrations(raw, version, migrations);
    switch (migrated.kind) {
      case 'too-new':
        return { value: schema.parse({}), status: 'too-new', writable: false };
      case 'current':
        return { value: schema.parse(migrated.doc), status: 'current', writable: true };
      case 'migrated':
        return { value: schema.parse(migrated.doc), status: 'migrated', writable: true };
      default: {
        const exhaustive: never = migrated;
        throw new Error(`Unhandled migration result ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /** True when the file on disk is exactly what this instance last wrote. */
  isOwnWrite(text: string): boolean {
    return text === this.#lastWritten;
  }

  write(value: T): Promise<void> {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    this.#lastWritten = text;
    const next = this.#writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, text, 'utf8');
      await rename(temp, this.path);
    });
    this.#writeChain = next.catch(() => undefined);
    return next;
  }

  /** Resolves once every queued write has finished. */
  flush(): Promise<void> {
    return this.#writeChain;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
