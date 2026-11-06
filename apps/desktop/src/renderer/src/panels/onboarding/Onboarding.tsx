import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Bell,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  MousePointerClick,
  Play,
  Sparkles,
  Star,
  Volume2,
  X,
} from 'lucide-react';
import { CommandId, type AgentVerification } from '@arbora/shared';
import { toggleDefaultAgent, useDefaultAgentId } from '../../agent-defaults';
import { usePickableAgents, verifyAgent } from '../../agent-pickers';
import { loadAgentSnapshot, useAgents } from '../../agent-store';
import { runDevServer, setChordProbe, toggleMode } from '../../commands';
import { Dialog } from '../../components/Dialog';
import { setStartDefaultOnOpen } from '../../grove-store';
import { useChordLabel } from '../../keybindings';
import { openProjectPath } from '../../projects-store';
import { updateProjectSettings, updateSettings } from '../../settings-client';
import { playSound } from '../../sounds';
import { closeOverlay, openSettings, useApp } from '../../store';
import { useTerminals } from '../../terminal-store';
import { TaskDefaults } from '../settings/TaskAgentPicker';
import { PasswordCheck, SetupButton } from '../settings/PasswordsSection';

const STEPS = [
  'welcome',
  'project',
  'dev',
  'agents',
  'tasks',
  'grove',
  'keys',
  'alerts',
  'passwords',
  'finish',
] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Readonly<Record<Step, string>> = {
  welcome: 'Welcome',
  project: 'Project',
  dev: 'Dev server',
  agents: 'Agents',
  tasks: 'Task defaults',
  grove: 'Grove',
  keys: 'Shortcuts',
  alerts: 'Alerts',
  passwords: 'Passwords',
  finish: 'Try it',
};

function finish(): void {
  void updateSettings({ onboarding: { completed: true } });
  closeOverlay('onboarding');
}

function StepShell({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-fg-muted">{lead}</p>
      </div>
      {children}
    </div>
  );
}

function WelcomeStep() {
  const items = [
    {
      icon: MousePointerClick,
      title: 'Agent mode',
      text: 'Point at a component on your running page and say what to change.',
    },
    {
      icon: Sparkles,
      title: 'Design mode',
      text: 'Nudge spacing, colours and text by hand, then hand the diff to the agent.',
    },
    {
      icon: Bot,
      title: 'Any ACP agent',
      text: 'Claude Code, Codex, Kimi Code, Grok Build, OpenCode or your own, in groups.',
    },
  ];
  return (
    <StepShell
      title="Welcome to Arbora"
      lead="A few steps get you from here to a working agent-mode prompt on your own app. Everything can be changed later in Settings."
    >
      <ul className="grid gap-2">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-lg border border-border bg-bg p-3">
            <Icon size={16} className="mt-0.5 shrink-0 text-accent" />
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-fg-muted">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </StepShell>
  );
}

function ProjectStep() {
  const project = useApp((s) => s.project);
  const recents = useApp((s) => s.settings.recentProjects).slice(0, 4);
  if (project) {
    return (
      <StepShell title="Your project" lead="Arbora works on one project folder per window.">
        <p className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/40 px-3 py-2 text-sm">
          <CheckCircle2 size={14} className="text-accent" />
          <span className="font-medium">{project.name}</span>
          <span className="truncate font-mono text-[11px] text-fg-subtle">{project.path}</span>
        </p>
      </StepShell>
    );
  }
  return (
    <StepShell title="Open a project" lead="Pick the folder of the web app you want to work on.">
      <button
        type="button"
        data-testid="onboarding-open-folder"
        onClick={() => void openProjectPath()}
        className="flex items-center gap-3 rounded-lg border border-border bg-bg px-4 py-3 text-left hover:border-accent"
      >
        <FolderOpen size={16} className="text-accent" />
        <span className="flex-1 font-medium">Open project folder…</span>
      </button>
      {recents.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {recents.map((recent) => (
            <li key={recent.path}>
              <button
                type="button"
                onClick={() => void openProjectPath(recent.path)}
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-bg-subtle"
              >
                <span className="font-medium">{recent.name}</span>
                <span className="truncate font-mono text-[11px] text-fg-subtle">{recent.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </StepShell>
  );
}

function DevStep() {
  const project = useApp((s) => s.project);
  const devRunning = useTerminals((s) => s.terminals.some((t) => t.kind === 'dev' && t.exitCode === null));
  const starting = useTerminals((s) => s.devStarting);
  const [command, setCommand] = useState(project?.settings.devCommand ?? '');
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    if (!project) return;
    void window.arbora.invoke('project.detectDevCommand').then(({ command: found }) => {
      setDetected(found);
      setCommand((current) => current || found || '');
    });
  }, [project]);
  if (!project) {
    return <StepShell title="Dev server" lead="Open a project first; Arbora reads its package.json scripts." />;
  }
  const saved = project.settings.devCommand;
  return (
    <StepShell
      title="Start the dev server"
      lead="Arbora runs it in a terminal and opens the URL it prints in the browser panel."
    >
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        Dev command{detected ? ` (detected from package.json: ${detected})` : ''}
        <input
          data-testid="onboarding-dev-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="pnpm dev"
          className="h-8 rounded border border-border bg-bg px-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="onboarding-dev-start"
          disabled={!command.trim() || starting}
          onClick={() => {
            void (async () => {
              if (command.trim() !== saved && !(await updateProjectSettings({ devCommand: command.trim() }))) return;
              await runDevServer();
            })();
          }}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-40"
        >
          {starting ? <LoaderCircle size={12} className="animate-spin" /> : <Play size={12} />}
          {devRunning ? 'Restart dev server' : 'Save and start'}
        </button>
        {devRunning && (
          <span className="flex items-center gap-1 text-xs text-accent" data-testid="onboarding-dev-running">
            <CheckCircle2 size={12} /> Running
          </span>
        )}
      </div>
      <p className="text-xs text-fg-subtle">
        Not a Node project? Type any command, for example <code className="font-mono">python -m http.server 8000</code>.
      </p>
    </StepShell>
  );
}

function AgentStatus({ verification, checking }: { verification: AgentVerification | undefined; checking: boolean }) {
  if (checking) {
    return (
      <span className="flex items-center gap-1 text-xs text-fg-muted">
        <LoaderCircle size={12} className="animate-spin" /> Testing…
      </span>
    );
  }
  if (!verification) {
    return (
      <span className="flex items-center gap-1 text-xs text-fg-subtle">
        <CircleDashed size={11} /> Not tested
      </span>
    );
  }
  switch (verification.status) {
    case 'ready':
      return <span className="text-xs text-accent">Connected</span>;
    case 'auth_required':
      return <span className="text-xs text-attention">Needs login</span>;
    case 'missing':
      return <span className="text-xs text-fg-subtle">Not installed</span>;
    case 'error':
      return <span className="text-xs text-danger">Failed to start</span>;
    default: {
      const unreachable: never = verification.status;
      return unreachable;
    }
  }
}

function AgentsStep() {
  const project = useApp((s) => s.project);
  const agents = useAgents((s) => s.agents);
  const availability = useAgents((s) => s.availability);
  const verified = useApp((s) => s.settings.agents.verified);
  const checking = useApp((s) => s.checkingAgents);
  const defaultAgent = useDefaultAgentId();
  useEffect(() => {
    if (project && agents.length === 0) void loadAgentSnapshot().catch(() => undefined);
  }, [project, agents.length]);
  if (!project) {
    return <StepShell title="Agents" lead="Open a project first; agents run in its folder." />;
  }
  const installed = new Set(availability.filter((a) => a.available).map((a) => a.id));
  const sorted = [...agents].sort((a, b) => Number(installed.has(b.id)) - Number(installed.has(a.id)));
  return (
    <StepShell
      title="Connect an agent"
      lead="Test connection starts the agent once (ACP initialize and a session) to check that you are signed in. Star the one new threads should use."
    >
      <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto" data-testid="onboarding-agents">
        {sorted.map((agent) => {
          const ready = verified[agent.id]?.status === 'ready';
          const isDefault = defaultAgent === agent.id;
          return (
            <li
              key={agent.id}
              data-testid={`onboarding-agent-${agent.id}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {agent.name}
                  {!installed.has(agent.id) && (
                    <span className="rounded bg-bg-muted px-1 text-[10px] text-fg-subtle">not found on PATH</span>
                  )}
                </div>
                {!ready && agent.installHint && (
                  <div className="truncate text-[11px] text-fg-subtle" title={agent.installHint}>
                    {agent.installHint}
                  </div>
                )}
              </div>
              <AgentStatus verification={verified[agent.id]} checking={checking.includes(agent.id)} />
              <button
                type="button"
                data-testid={`onboarding-test-${agent.id}`}
                disabled={checking.includes(agent.id)}
                onClick={() => void verifyAgent(agent.id)}
                className="rounded border border-border px-2 py-1 text-xs hover:bg-bg-muted disabled:opacity-40"
              >
                Test connection
              </button>
              <button
                type="button"
                aria-pressed={isDefault}
                aria-label={isDefault ? `${agent.name} is the default agent` : `Use ${agent.name} as the default agent`}
                disabled={!ready}
                onClick={() => toggleDefaultAgent(agent.id)}
                className={clsx('rounded p-1 disabled:opacity-30', isDefault ? 'text-accent' : 'text-fg-subtle')}
              >
                <Star size={14} className={clsx(isDefault && 'fill-current')} />
              </button>
            </li>
          );
        })}
      </ul>
    </StepShell>
  );
}

function TasksStep() {
  const project = useApp((s) => s.project);
  if (!project) return <StepShell title="Task defaults" lead="Open a project first; agents run in its folder." />;
  return (
    <StepShell
      title="Pick an agent for each job"
      lead="Agent mode, design mode, fixing problems and commit messages can each start threads with their own agent and model. Leave one on Default agent to use the starred agent. You can change these later in Settings → Agents."
    >
      <TaskDefaults />
    </StepShell>
  );
}

/** The chords a step asks the user to press; onboarding takes them instead of running them. */
const PROBED_CHORDS: Partial<Readonly<Record<Step, readonly string[]>>> = {
  grove: [CommandId.toggleMaximizeRight],
  keys: [CommandId.agentMode, CommandId.designMode],
};

function ChordCheck({ id, text, pressed }: { id: string; text: string; pressed: ReadonlySet<string> }) {
  const label = useChordLabel(id);
  const done = pressed.has(id);
  return (
    <li
      data-testid={`onboarding-chord-${id}`}
      data-pressed={done || undefined}
      className={clsx(
        'flex items-center gap-3 rounded-lg border px-3 py-2.5',
        done ? 'border-accent/50 bg-accent-soft/40' : 'border-border bg-bg',
      )}
    >
      <kbd className="min-w-16 rounded border border-border bg-bg-muted px-2 py-0.5 text-center font-mono text-sm">
        {label ?? 'unbound'}
      </kbd>
      <span className="flex-1 text-sm">{text}</span>
      {done ? (
        <span className="flex items-center gap-1 text-xs text-accent">
          <Check size={12} /> Works
        </span>
      ) : (
        <span className="text-xs text-fg-subtle">Press it now</span>
      )}
    </li>
  );
}

function GroveStep({ pressed }: { pressed: ReadonlySet<string> }) {
  const project = useApp((s) => s.project);
  const pickable = usePickableAgents();
  const defaultAgent = useDefaultAgentId();
  if (!project) return <StepShell title="Grove" lead="Open a project first; Grove lists the agents working in it." />;
  const startOnOpen = project.settings.startDefaultOnOpen !== false;
  return (
    <StepShell
      title="Run several agents in Grove"
      lead="Grove swaps the page for every agent in this project: who is working, who needs you, and one transcript at a time. Agents keep running when you switch back to the page."
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs text-fg-muted">The agent Grove starts for this project</span>
        {pickable.length === 0 ? (
          <p className="rounded-lg border border-border bg-bg px-3 py-2 text-xs text-fg-subtle">
            Connect an agent in the Agents step first, then pick it here.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Default agent for this project"
            data-testid="onboarding-grove-agents"
            className="flex flex-wrap gap-1.5"
          >
            {pickable.map(({ agent }) => (
              <button
                key={agent.id}
                type="button"
                role="radio"
                aria-checked={defaultAgent === agent.id}
                data-testid={`onboarding-grove-agent-${agent.id}`}
                onClick={() => void updateProjectSettings({ defaultAgent: agent.id })}
                className={clsx(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
                  defaultAgent === agent.id
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-border bg-bg hover:border-accent',
                )}
              >
                <Bot size={12} />
                {agent.name}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={startOnOpen}
            data-testid="onboarding-grove-start-on-open"
            onChange={(event) => void setStartDefaultOnOpen(event.target.checked)}
          />
          Start it when the project has no agents
        </label>
      </div>
      <ul className="grid gap-2">
        <ChordCheck
          id={CommandId.toggleMaximizeRight}
          text="Give the page the whole window, and back"
          pressed={pressed}
        />
      </ul>
    </StepShell>
  );
}

function KeysStep({ pressed }: { pressed: ReadonlySet<string> }) {
  const platform = useApp((s) => s.info.platform);
  return (
    <StepShell
      title="Your two shortcuts"
      lead={
        platform === 'darwin'
          ? 'Press each one now to check that it reaches Arbora.'
          : 'Arbora uses Ctrl, not Super, because Hyprland, GNOME and Windows take Super chords first. Press each one now.'
      }
    >
      <ul className="grid gap-2">
        <ChordCheck id={CommandId.agentMode} text="Agent mode: point at a component" pressed={pressed} />
        <ChordCheck id={CommandId.designMode} text="Design mode: edit visually" pressed={pressed} />
      </ul>
      <button
        type="button"
        onClick={() => openSettings('keyboard')}
        className="flex items-center gap-1.5 self-start text-xs text-accent hover:underline"
      >
        <Keyboard size={12} /> Change shortcuts
      </button>
    </StepShell>
  );
}

function AlertsStep() {
  const notifications = useApp((s) => s.settings.notifications);
  const sounds = useApp((s) => s.settings.sounds);
  const row = (icon: ReactNode, title: string, detail: string, on: boolean, toggle: () => void, testId: string) => (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2.5">
      {icon}
      <span className="flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-fg-muted">{detail}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        data-testid={testId}
        onClick={toggle}
        className={clsx('relative h-4 w-7 shrink-0 rounded-full', on ? 'bg-accent' : 'bg-border')}
      >
        <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow', on ? 'left-3.5' : 'left-0.5')} />
      </button>
    </li>
  );
  return (
    <StepShell
      title="Know when an agent needs you"
      lead="Agents keep working while you look at the page. Arbora tells you when one asks for permission, finishes or fails."
    >
      <ul className="grid gap-2">
        {row(
          <Bell size={16} className="text-accent" />,
          'Desktop notifications',
          'When Arbora is in the background. Click one to jump to the thread.',
          notifications.enabled,
          () => void updateSettings({ notifications: { enabled: !notifications.enabled } }),
          'onboarding-notifications',
        )}
        {row(
          <Volume2 size={16} className="text-accent" />,
          'Sounds',
          'A chime when a turn finishes, a ping when an agent waits for you.',
          sounds.enabled,
          () => void updateSettings({ sounds: { enabled: !sounds.enabled } }),
          'onboarding-sounds',
        )}
      </ul>
      <button
        type="button"
        onClick={() => playSound(sounds.finished === 'none' ? 'chime' : sounds.finished, sounds.volume || 60)}
        className="self-start text-xs text-accent hover:underline"
      >
        Play the “finished” sound
      </button>
    </StepShell>
  );
}

function PasswordsStep() {
  const on = useApp((s) => s.settings.passwords.provider === '1password');
  return (
    <StepShell
      title="Sign in with 1Password"
      lead="Use it for the app and for tools such as Figma. Arbora never stores the password. The check only looks for the op command."
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="onboarding-passwords"
          checked={on}
          onChange={(event) =>
            void updateSettings({ passwords: { provider: event.target.checked ? '1password' : 'none' } })
          }
        />
        Use 1Password
      </label>
      <PasswordCheck />
      <SetupButton />
      <p className="text-xs text-fg-subtle">
        Run setup opens the script in a terminal. On Linux it asks before it uses sudo. The app does not install
        packages itself.
      </p>
    </StepShell>
  );
}

function FinishStep() {
  const agentLabel = useChordLabel(CommandId.agentMode);
  const hasPage = useApp((s) => Boolean(s.browser?.url && /^https?:/.test(s.browser.url)));
  return (
    <StepShell
      title="Try agent mode"
      lead={`Press ${agentLabel ?? 'the agent-mode chord'} on your running page, click a component, and describe the change.`}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">
        <li>Hover the page: Arbora outlines components and names them.</li>
        <li>Click one: a prompt opens next to it, with its source and a screenshot attached.</li>
        <li>Press Enter: the agent edits the code, and checks its work in the browser.</li>
      </ol>
      {!hasPage && (
        <p className="text-xs text-fg-subtle">
          The browser panel has no page yet. Start the dev server first, or type a URL in the browser panel.
        </p>
      )}
    </StepShell>
  );
}

/**
 * First-run setup (F-ONBOARD-01): project, dev command, agents with a connection test, task
 * defaults, Grove's default agent and workspace chord, the mode chords (each with a "press it now"
 * check), notifications and sounds, then a guided `Mod+K`.
 */
export default function Onboarding() {
  const open = useApp((s) => s.overlay === 'onboarding');
  const project = useApp((s) => s.project);
  const [step, setStep] = useState<Step>('welcome');
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());
  const index = STEPS.indexOf(step);

  useEffect(() => {
    const probed = PROBED_CHORDS[step];
    if (!open || !probed) return;
    setChordProbe((commandId) => {
      if (!probed.includes(commandId)) return false;
      setPressed((current) => new Set(current).add(commandId));
      return true;
    });
    return () => setChordProbe(null);
  }, [open, step]);

  useEffect(() => {
    if (pressed.size > 0) void updateSettings({ onboarding: { checkedChords: [...pressed] } });
  }, [pressed]);

  if (!open) return null;

  const next = (): void => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)] ?? 'finish');
  const back = (): void => setStep(STEPS[Math.max(index - 1, 0)] ?? 'welcome');
  const tryIt = (): void => {
    finish();
    if (project) toggleMode('agent');
  };

  return (
    <Dialog label="Getting started" testId="onboarding" onClose={finish} width={640}>
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
        <span className="flex-1 text-sm font-semibold">Getting started</span>
        <button
          type="button"
          data-testid="onboarding-skip"
          onClick={finish}
          className="text-xs text-fg-subtle hover:text-fg"
        >
          Skip setup
        </button>
        <button type="button" aria-label="Close" onClick={finish} className="rounded p-1 text-fg-subtle hover:text-fg">
          <X size={15} />
        </button>
      </header>
      <nav aria-label="Setup steps" className="flex gap-1 border-b border-border px-5 py-2">
        {STEPS.map((id, i) => (
          <button
            key={id}
            type="button"
            aria-current={id === step ? 'step' : undefined}
            onClick={() => setStep(id)}
            className={clsx(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
              id === step ? 'bg-accent-soft font-medium text-accent' : i < index ? 'text-fg-muted' : 'text-fg-subtle',
            )}
          >
            {i < index && <Check size={10} />}
            {STEP_LABELS[id]}
          </button>
        ))}
      </nav>
      <div className="min-h-80 overflow-auto px-6 py-5" data-testid={`onboarding-step-${step}`}>
        {step === 'welcome' && <WelcomeStep />}
        {step === 'project' && <ProjectStep />}
        {step === 'dev' && <DevStep />}
        {step === 'agents' && <AgentsStep />}
        {step === 'tasks' && <TasksStep />}
        {step === 'grove' && <GroveStep pressed={pressed} />}
        {step === 'keys' && <KeysStep pressed={pressed} />}
        {step === 'alerts' && <AlertsStep />}
        {step === 'passwords' && <PasswordsStep />}
        {step === 'finish' && <FinishStep />}
      </div>
      <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
        <span className="flex-1 text-[11px] text-fg-subtle">
          Step {index + 1} of {STEPS.length}
        </span>
        {index > 0 && (
          <button type="button" onClick={back} className="rounded border border-border px-3 py-1.5 text-xs">
            Back
          </button>
        )}
        {step === 'finish' ? (
          <button
            type="button"
            data-testid="onboarding-finish"
            data-autofocus
            onClick={tryIt}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
          >
            {project ? 'Finish and try agent mode' : 'Finish'}
          </button>
        ) : (
          <button
            type="button"
            data-testid="onboarding-next"
            data-autofocus
            onClick={next}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
          >
            {step === 'welcome' ? 'Get started' : 'Next'}
          </button>
        )}
      </footer>
    </Dialog>
  );
}
