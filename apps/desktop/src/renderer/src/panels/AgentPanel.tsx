import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useAgents } from '../agent-store';
import { useApp } from '../store';
import { AgentPicker } from './agent/AgentPicker';
import { ThreadList } from './agent/ThreadList';

// The transcript (Markdown, highlight.js grammars, diffs) loads with the first open thread.
const ThreadView = lazy(() => import('./agent/ThreadView'));

function ThreadFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-fg-subtle">
      <Loader2 size={14} className="animate-spin" />
    </div>
  );
}

export default function AgentPanel() {
  const projectPath = useApp((s) => s.project?.path ?? '');
  const view = useAgents((s) => s.view);
  const loaded = useAgents((s) => s.loaded);
  const thread = useAgents((s) => s.threads.find((t) => t.id === s.activeThreadId));

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-fg-subtle" data-testid="agent-panel">
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }

  const body = (): React.JSX.Element => {
    switch (view) {
      case 'threads':
        return <ThreadList />;
      case 'picker':
        return <AgentPicker />;
      case 'thread':
        return thread ? (
          <Suspense fallback={<ThreadFallback />}>
            <ThreadView thread={thread} projectPath={projectPath} />
          </Suspense>
        ) : (
          <ThreadList />
        );
      default: {
        const unreachable: never = view;
        return unreachable;
      }
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="agent-panel" data-view={view} data-picker-bounds>
      {body()}
    </div>
  );
}
