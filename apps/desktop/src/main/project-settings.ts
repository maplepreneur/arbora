import { join } from 'node:path';
import {
  projectSettingsMigrations,
  projectSettingsSchema,
  PROJECT_SETTINGS_VERSION,
  type ProjectSettings,
  type ProjectSettingsPatch,
} from '@arbora/shared';
import { VersionedJsonFile } from './json-file';
import { stripUndefined } from './settings-service';

export const PROJECT_DATA_DIR = '.arbora';

/**
 * `<project>/.arbora/project.json`: committed per-project settings. Nothing is written until a
 * setting actually changes, so opening a project leaves its tree untouched.
 */
export class ProjectSettingsStore {
  readonly #file: VersionedJsonFile<ProjectSettings>;
  #settings: ProjectSettings;
  #writable: boolean;

  constructor(projectPath: string) {
    this.#file = new VersionedJsonFile({
      path: join(projectPath, PROJECT_DATA_DIR, 'project.json'),
      version: PROJECT_SETTINGS_VERSION,
      schema: projectSettingsSchema,
      migrations: projectSettingsMigrations,
    });
    const result = this.#file.load();
    this.#settings = result.value;
    this.#writable = result.writable;
  }

  get settings(): ProjectSettings {
    return this.#settings;
  }

  async update(patch: ProjectSettingsPatch): Promise<ProjectSettings> {
    this.#settings = projectSettingsSchema.parse({ ...this.#settings, ...stripUndefined(patch) });
    if (this.#writable) await this.#file.write(this.#settings);
    return this.#settings;
  }

  flush(): Promise<void> {
    return this.#file.flush();
  }
}
