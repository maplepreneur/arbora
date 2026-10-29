import { CommandId } from '@arbora/shared';
import { useChordLabel } from '../chords';
import { PanelHeader, PanelPlaceholder } from './PanelPlaceholder';

export default function AgentPanel() {
  const agentChord = useChordLabel(CommandId.agentMode);
  return (
    <section data-testid="panel-agent" aria-label="Agent" className="flex h-full flex-col">
      <PanelHeader>Agent</PanelHeader>
      <PanelPlaceholder title="No agent connected">
        <span>
          Connect Claude Code, Codex, Kimi Code, Grok Build or your own ACP agent.
          {agentChord ? ` Then press ${agentChord} to point at a component.` : ''}
        </span>
      </PanelPlaceholder>
    </section>
  );
}
