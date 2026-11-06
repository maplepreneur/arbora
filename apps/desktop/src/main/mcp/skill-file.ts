import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { browserSkill, SKILL_FILE } from '@arbora/acp-client';
import { ensureArboraGitignore, readProjectSettings } from '../project-settings.js';

/**
 * Writes `.arbora/SKILL.md` (the browser-tools guide the preface points agents at) when it is
 * missing or out of date. The text does not depend on the dev URL. It changes with Arbora, the
 * Grove orchestration setting, and the project's design-match stop rule.
 */
export function writeSkillFile(projectPath: string, groveTools: boolean): void {
  const file = join(projectPath, SKILL_FILE);
  const match = readProjectSettings(projectPath).settings.designMatch;
  const content = browserSkill({
    projectPath,
    devUrl: null,
    groveTools,
    ...(match ? { designMatch: { threshold: match.threshold, maxRounds: match.maxRounds } } : {}),
  });
  ensureArboraGitignore(projectPath, true);
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === content) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
  } catch (error) {
    console.warn(`[browser-tools] could not write ${SKILL_FILE}: ${(error as Error).message}`);
  }
}
