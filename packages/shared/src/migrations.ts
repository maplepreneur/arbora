export type JsonObject = Record<string, unknown>;

/** `migrations[n]` upgrades a document from version `n` to `n + 1`. Unversioned documents are version 0. */
export type MigrationTable = Readonly<Record<number, (doc: JsonObject) => JsonObject>>;

export type MigrationResult =
  | { readonly kind: 'current'; readonly doc: JsonObject }
  | { readonly kind: 'migrated'; readonly doc: JsonObject; readonly from: number }
  | { readonly kind: 'too-new'; readonly version: number };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readVersion(doc: JsonObject): number {
  const version = doc.version;
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0;
}

export function runMigrations(
  input: unknown,
  currentVersion: number,
  migrations: MigrationTable,
): MigrationResult {
  const doc: JsonObject = isJsonObject(input) ? { ...input } : {};
  const from = readVersion(doc);
  if (from > currentVersion) {
    return { kind: 'too-new', version: from };
  }
  if (from === currentVersion) {
    return { kind: 'current', doc };
  }
  let migrated = doc;
  for (let version = from; version < currentVersion; version++) {
    const step = migrations[version];
    if (!step) {
      throw new Error(`Missing migration from version ${version} to ${version + 1}`);
    }
    migrated = { ...step(migrated), version: version + 1 };
  }
  return { kind: 'migrated', doc: migrated, from };
}
