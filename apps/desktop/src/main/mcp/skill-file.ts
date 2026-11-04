import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { browserSkill, SKILL_FILE } from '@arbora/acp-client';
import { ensureArboraGitignore } from '../project-settings.js';

/**
 * Writes `.arbora/SKILL.md` (the browser-tools guide the preface points agents at) when it is
 * missing or out of date. The text does not depend on the dev URL, so it only changes with Arbora.
 */
export function writeSkillFile(projectPath: string): void {
  const file = join(projectPath, SKILL_FILE);
  const content = browserSkill({ projectPath, devUrl: null });
  ensureArboraGitignore(projectPath, true);
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === content) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  } catch (error) {
    console.warn(`[browser-tools] could not write ${SKILL_FILE}: ${(error as Error).message}`);
  }
}
