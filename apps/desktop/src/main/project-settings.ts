import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PROJECT_SETTINGS_VERSION, projectSettingsSchema, type ProjectSettings } from '@arbora/shared';
import { writeJsonAtomic } from './settings-store.js';

export const ARBORA_DIR = '.arbora';

export function projectSettingsPath(projectPath: string): string {
  return join(projectPath, ARBORA_DIR, 'project.json');
}

export interface ReadProjectSettingsResult {
  readonly settings: ProjectSettings;
  readonly warnings: string[];
}

export function readProjectSettings(projectPath: string): ReadProjectSettingsResult {
  const file = projectSettingsPath(projectPath);
  const defaults: ProjectSettings = { version: PROJECT_SETTINGS_VERSION };
  if (!existsSync(file)) return { settings: defaults, warnings: [] };
  try {
    const parsed = projectSettingsSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (parsed.success) return { settings: parsed.data, warnings: [] };
    return { settings: defaults, warnings: [`.arbora/project.json is invalid: ${z.prettifyError(parsed.error)}`] };
  } catch (error) {
    return { settings: defaults, warnings: [`.arbora/project.json could not be read: ${(error as Error).message}`] };
  }
}

/**
 * Sets fields in `.arbora/project.json`, keeping everything else in the file (including keys this
 * version does not know). An `undefined` value removes the field. An unreadable file is left alone
 * and reported.
 */
export function updateProjectSettingsFile(projectPath: string, patch: Readonly<Record<string, unknown>>): void {
  const file = projectSettingsPath(projectPath);
  let current: Record<string, unknown> = { version: PROJECT_SETTINGS_VERSION };
  if (existsSync(file)) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('.arbora/project.json is not a JSON object');
    }
    current = parsed as Record<string, unknown>;
  }
  writeJsonAtomic(file, { ...current, ...patch });
}

/** Creates `.arbora/project.json` with defaults if it does not exist yet. Returns its path. */
export function ensureProjectSettingsFile(projectPath: string): string {
  const file = projectSettingsPath(projectPath);
  if (!existsSync(file)) {
    writeJsonAtomic(file, { version: PROJECT_SETTINGS_VERSION });
  }
  return file;
}
