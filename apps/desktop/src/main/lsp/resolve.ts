import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface TypeScriptLspLaunch {
  readonly cli: string;
  readonly tsserver: string;
}

/**
 * The project's own language server and the TypeScript it must use. A missing package is an
 * error the editor can show; Arbora does not ship a second TypeScript.
 */
export function resolveTypeScriptLsp(projectPath: string): TypeScriptLspLaunch | { error: string } {
  const tsserver = join(projectPath, 'node_modules', 'typescript', 'lib', 'tsserver.js');
  if (!existsSync(tsserver)) {
    return { error: 'This project has no TypeScript in node_modules. The language server uses that copy.' };
  }
  const cli = join(projectPath, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
  if (!existsSync(cli)) {
    return { error: 'Install typescript-language-server in this project to turn the language server on.' };
  }
  return { cli, tsserver };
}
