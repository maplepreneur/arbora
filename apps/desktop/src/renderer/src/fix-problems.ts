import { fixDiagnosticsPrompt, fixPageProblemsPrompt, type Diagnostic, type ProblemEntry } from '@arbora/shared';
import { taskAgent } from './agent-defaults';
import { createThread, sendPrompt, setDraft, useAgents } from './agent-store';
import { showAgentThread } from './commands';
import { ipcError } from './ipc-error';
import { showToast, useApp } from './store';

/** Starts a thread with the "Fix problems" task's agent and model, and sends it `prompt`. */
async function fixWithAgent(prompt: string): Promise<void> {
  if (!useApp.getState().project) {
    showToast('Open a project first');
    return;
  }
  const task = taskAgent('fix');
  if (!task) {
    showToast('Connect an agent in Settings → Agents first.');
    return;
  }
  try {
    await createThread(task.agentId, task.model ?? undefined);
    const threadId = useAgents.getState().activeThreadId;
    if (!threadId) return;
    await showAgentThread(threadId);
    setDraft(threadId, prompt);
    const result = await sendPrompt(threadId);
    if (result.error) showToast(result.error);
  } catch (error) {
    showToast(`Could not start the agent: ${ipcError(error)}`);
  }
}

export function fixPageProblems(problems: readonly ProblemEntry[]): Promise<void> {
  return fixWithAgent(fixPageProblemsPrompt(problems, useApp.getState().browser?.url || null));
}

export function fixDiagnostics(diagnostics: readonly Diagnostic[]): Promise<void> {
  return fixWithAgent(fixDiagnosticsPrompt(diagnostics));
}
