import { formatWithProject, lintWithProject } from './project-tools.js';
import type { ToolRequest, ToolResponse } from './protocol.js';

/**
 * Entry of the tooling utility process (`out/main/tooling-worker.js`). Runs the project's Prettier
 * and ESLint off the main process; one request at a time per message, answered by id.
 */
async function handle(request: ToolRequest): Promise<ToolResponse> {
  try {
    switch (request.type) {
      case 'format':
        return {
          id: request.id,
          ok: true,
          type: 'format',
          result: await formatWithProject(request.root, request.file, request.content),
        };
      case 'lint':
        return {
          id: request.id,
          ok: true,
          type: 'lint',
          result: await lintWithProject(request.root, request.file, request.content),
        };
      default: {
        const unreachable: never = request;
        throw new Error(`Unknown request ${JSON.stringify(unreachable)}`);
      }
    }
  } catch (error) {
    return { id: request.id, ok: false, error: (error as Error).message.split('\n')[0] ?? 'Tool failed' };
  }
}

process.parentPort.on('message', (event: { data: ToolRequest }) => {
  void handle(event.data).then((response) => process.parentPort.postMessage(response));
});
