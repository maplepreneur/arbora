import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  detectProjectCommands,
  detectProjectFramework,
  mcpServersFor,
  packageManagerFor,
  type Events,
  type PayloadOf,
  type Platform,
  type ProjectCommand,
  type ProjectFramework,
  type ProjectSettings,
} from '@arbora/shared';
import type { AgentRegistry } from '@arbora/acp-client';
import { AgentService } from './agent/agent-service.js';
import { findCandidates } from './agent-mode/source-search.js';
import type { BrowserService } from './browser/browser-service.js';
import type { BrowserTabs } from './browser/browser-tabs.js';
import type { TabGrantStore } from './browser/tab-grants.js';
import { ArboraToolHost, type PermissionAnswer } from './mcp/browser-tool-host.js';
import { openBrowserTools, type ShimCommand } from './mcp/browser-tools.js';
import { GroveHost } from './mcp/grove-tool-host.js';
import { OnePasswordProvider, runOp } from './passwords/one-password.js';
import { SecretMask } from './passwords/secret-mask.js';
import { readProjectSettings, updateProjectSettingsFile } from './project-settings.js';
import { writeSkillFile } from './mcp/skill-file.js';
import type { SettingsStore } from './settings-store.js';
import { DevServer } from './terminal/dev-server.js';
import { findExecutable, type ShellEnvironment } from './terminal/shell-env.js';
import { TerminalService } from './terminal/terminal-service.js';

export interface ProjectRuntimeHost {
  browser(): BrowserService | null;
  tabs?: () => BrowserTabs | null;
  grants?: TabGrantStore;
  /** A window showing this project loaded the URL in its browser. */
  suggestUrl(url: string): boolean;
  reloadProjectSettings(): void;
  send<K extends keyof Events>(name: K, payload: PayloadOf<Events[K]>): void;
}

export interface ProjectRuntimeOptions {
  readonly path: string;
  readonly platform: Platform;
  readonly settings: SettingsStore;
  readonly agentRegistry: AgentRegistry;
  readonly shellEnvironment: ShellEnvironment;
  readonly mcpShim: ShimCommand;
  readonly appVersion: string;
  readonly host: ProjectRuntimeHost;
}

/**
 * The terminals, dev server and ACP agents of one project folder. Windows share one of these
 * instead of each starting its own, so Grove can keep several projects running in one window.
 */
export class ProjectRuntime {
  readonly terminals: TerminalService;
  readonly devServer: DevServer;
  readonly agents: AgentService;
  readonly secrets = new SecretMask();
  readonly passwords: OnePasswordProvider;
  private disposed = false;

  constructor(
    readonly path: string,
    options: ProjectRuntimeOptions,
  ) {
    const { platform, settings, shellEnvironment, host } = options;
    this.passwords = new OnePasswordProvider(async (args, stdin) => {
      await shellEnvironment.ready;
      const env = shellEnvironment.env();
      const override = process.env['ARBORA_OP'];
      const command = override ? override : (findExecutable('op', env, platform) ?? 'op');
      return runOp(command, env, args, stdin);
    }, this.secrets);
    const environment = async (): Promise<Record<string, string>> => {
      await shellEnvironment.ready;
      return shellEnvironment.env();
    };
    this.terminals = new TerminalService({
      platform,
      cwd: path,
      environment,
      shell: () => settings.get().terminal.shell,
      events: {
        data: (id, data) => host.send('terminal.data', { projectPath: path, id, data }),
        changed: (terminals) => host.send('terminal.changed', { projectPath: path, terminals }),
        url: (id, url) => {
          this.devServer.noteUrl(id, url);
          const opened = host.suggestUrl(url);
          host.send('terminal.urlDetected', { projectPath: path, id, url, opened });
        },
      },
    });
    this.devServer = new DevServer({
      terminals: this.terminals,
      projectPath: path,
      settings: () => this.projectSettings(),
      saveDevCommand: (command) => {
        try {
          updateProjectSettingsFile(path, { devCommand: command });
        } catch (error) {
          console.warn(`[dev-server] could not save devCommand: ${(error as Error).message}`);
        }
        host.reloadProjectSettings();
      },
    });
    this.agents = new AgentService({
      platform,
      projectPath: path,
      registry: options.agentRegistry,
      environment,
      lookup: () => {
        const env = shellEnvironment.env();
        return (command) => findExecutable(command, env, platform);
      },
      terminals: this.terminals,
      devUrl: () => {
        const dev = this.devServer.status().url;
        if (dev) return dev;
        const url = host.browser()?.getState().url;
        return url && /^https?:\/\//.test(url) ? url : null;
      },
      defaultModel: (agentId) => settings.get().agents.defaultModels[agentId],
      permissions: {
        get: () => settings.get().agents.permissions,
        remember: (key, decision) =>
          settings.update((current) => ({
            ...current,
            agents: { ...current.agents, permissions: { ...current.agents.permissions, [key]: decision } },
          })),
      },
      mcp: (threadId) => this.openBrowserTools(options, threadId),
      mcpTransport: process.env['ARBORA_MCP_TRANSPORT'] === 'stdio' ? 'stdio' : 'auto',
      userMcpServers: (agentId, http) => [
        ...mcpServersFor(settings.get().mcpServers, agentId, http),
        ...mcpServersFor(this.projectSettings().mcp?.extraServers ?? [], agentId, http),
      ],
      secrets: () => this.secrets.list(),
      events: {
        threadsChanged: (threads) => host.send('agent.threadsChanged', { projectPath: path, threads }),
        groupsChanged: (groups) => host.send('agent.groupsChanged', { projectPath: path, groups }),
        threadEvents: (threadId, changes) => host.send('agent.threadEvents', { projectPath: path, threadId, changes }),
        threadState: (threadId, state) => host.send('agent.threadState', { projectPath: path, threadId, state }),
        log: (threadId, entry) => host.send('agent.log', { projectPath: path, threadId, entry }),
        fileChanged: (threadId, file) => host.send('agent.fileChanged', { projectPath: path, threadId, path: file }),
      },
      onSessionEnded: (threadId) => {
        const closed = host.tabs?.()?.closeOpenedBy(threadId) ?? [];
        if (!host.grants || closed.length === 0) return;
        for (const id of closed) host.grants.dropTab(path, id);
        host.send('agent.grantsChanged', { threadId, tabIds: host.grants.list(path, threadId) });
      },
    });
  }

  projectSettings(): ProjectSettings {
    return readProjectSettings(this.path).settings;
  }

  /** A shell is still running, or an agent process is. */
  busy(): boolean {
    if (this.terminals.list().some((terminal) => terminal.exitCode === null)) return true;
    return this.agents
      .listThreads()
      .some(
        (thread) => thread.archivedAt === null && thread.state.status !== 'idle' && thread.state.status !== 'error',
      );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.agents.dispose().catch((error: unknown) => console.warn(`[agent] dispose: ${(error as Error).message}`));
    this.terminals.dispose();
  }

  private openBrowserTools(options: ProjectRuntimeOptions, threadId: string): ReturnType<typeof openBrowserTools> {
    const { platform, settings, shellEnvironment, host } = options;
    const projectPath = this.path;
    const orchestration = settings.get().grove.orchestration;
    writeSkillFile(projectPath, orchestration);
    const thread = this.agents.listThreads().find((candidate) => candidate.id === threadId);
    const grove =
      orchestration && thread?.parentThreadId === null
        ? new GroveHost({
            threadId,
            agents: () => this.agents,
            agentSettings: () => settings.get().agents,
            projectDefaultAgent: () => this.projectSettings().defaultAgent,
            maxHelpers: () => settings.get().grove.maxChildren,
          })
        : undefined;
    const toolHost = new ArboraToolHost({
      projectPath,
      browser: () => host.browser(),
      threadId,
      tabs: () => host.tabs?.() ?? null,
      ...(host.grants ? { grants: host.grants } : {}),
      passwords: () => settings.get().passwords,
      passwordProvider: this.passwords,
      allowLoginOrigin: (origin) => {
        settings.update((current) => {
          const list = current.passwords.alwaysAllow;
          if (!origin || list.includes(origin) || list.length >= 100) return current;
          return { ...current, passwords: { ...current.passwords, alwaysAllow: [...list, origin] } };
        });
      },
      secrets: this.secrets,
      devServer: () => this.devServer,
      terminals: () => this.terminals,
      projectSettings: () => this.projectSettings(),
      saveToolPolicy: (tool, policy) => {
        const current = this.projectSettings().browserTools ?? {};
        try {
          updateProjectSettingsFile(projectPath, { browserTools: { ...current, [tool]: policy } });
        } catch (error) {
          console.warn(`[browser-tools] could not save ${tool}: ${(error as Error).message}`);
        }
        host.reloadProjectSettings();
      },
      findCandidates: async (terms) => {
        await shellEnvironment.ready;
        const rg = findExecutable('rg', shellEnvironment.env(), platform) ?? null;
        return findCandidates(projectPath, terms, { rg });
      },
      askPermission: async (request): Promise<PermissionAnswer | null> => {
        const kind = await this.agents.requestToolPermission(threadId, {
          title: request.title,
          detail: request.detail,
          toolKind: request.tool === 'navigate' ? 'fetch' : 'execute',
          persistent: request.persistent ?? request.tool !== 'navigate',
        });
        switch (kind) {
          case 'allow_once':
            return 'once';
          case 'allow_always':
            return 'always';
          case 'reject_once':
            return 'reject';
          case 'reject_always':
            return 'never';
          case null:
            return null;
          default: {
            const unreachable: never = kind;
            throw new Error(`Unhandled permission kind ${String(unreachable)}`);
          }
        }
      },
      preview: (preview) => this.agents.addBrowserPreview(threadId, preview),
      trace: (step) => this.agents.addActionTrace(threadId, step),
    });
    return openBrowserTools(toolHost, options.mcpShim, options.appVersion, { grove });
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** The commands Grove can offer for this folder, from the manifests that are actually there. */
export async function readProjectCommands(root: string): Promise<ProjectCommand[]> {
  const [
    packageJson,
    procfileDev,
    makefile,
    composerJson,
    pnpm,
    yarn,
    bunLock,
    bunLockb,
    railsBin,
    application,
    binDev,
    binJobs,
    artisan,
    cargo,
    goMod,
    gemfile,
    specDir,
  ] = await Promise.all([
    readOptional(join(root, 'package.json')),
    readOptional(join(root, 'Procfile.dev')),
    readOptional(join(root, 'Makefile')),
    readOptional(join(root, 'composer.json')),
    fileExists(join(root, 'pnpm-lock.yaml')),
    fileExists(join(root, 'yarn.lock')),
    fileExists(join(root, 'bun.lock')),
    fileExists(join(root, 'bun.lockb')),
    fileExists(join(root, 'bin/rails')),
    fileExists(join(root, 'config/application.rb')),
    fileExists(join(root, 'bin/dev')),
    fileExists(join(root, 'bin/jobs')),
    fileExists(join(root, 'artisan')),
    fileExists(join(root, 'Cargo.toml')),
    fileExists(join(root, 'go.mod')),
    readOptional(join(root, 'Gemfile')),
    fileExists(join(root, 'spec')),
  ]);
  return detectProjectCommands({
    ...(packageJson !== undefined
      ? { packageJson, packageManager: packageManagerFor({ pnpm, yarn, bun: bunLock || bunLockb }) }
      : {}),
    ...(railsBin || application
      ? { rails: true, binDev, binJobs, specDir, ...(gemfile !== undefined ? { gemfile } : {}) }
      : {}),
    ...(procfileDev !== undefined ? { procfileDev } : {}),
    ...(makefile !== undefined ? { makefile } : {}),
    ...(composerJson !== undefined ? { composerJson } : {}),
    ...(artisan ? { artisan: true } : {}),
    ...(cargo ? { cargoToml: true } : {}),
    ...(goMod ? { goMod: true } : {}),
  });
}

/** The framework logo for this folder. An empty folder is Arbora. */
export async function readProjectFramework(root: string): Promise<ProjectFramework> {
  const [packageJson, gemfile, application, railsBin] = await Promise.all([
    readOptional(join(root, 'package.json')),
    readOptional(join(root, 'Gemfile')),
    fileExists(join(root, 'config/application.rb')),
    fileExists(join(root, 'bin/rails')),
  ]);
  return detectProjectFramework({
    ...(packageJson !== undefined ? { packageJson } : {}),
    ...(gemfile !== undefined ? { gemfile } : {}),
    ...(application || railsBin ? { rails: true } : {}),
  });
}
