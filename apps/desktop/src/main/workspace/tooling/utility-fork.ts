import { utilityProcess } from 'electron';
import type { ToolResponse } from './protocol.js';
import type { ForkTool } from './tooling-service.js';

/** `ForkTool` on Electron's `utilityProcess`: Node without the main process's event loop. */
export const forkUtility: ForkTool = (modulePath, args, { cwd, env, name }) => {
  const child = utilityProcess.fork(modulePath, [...args], { cwd, env, serviceName: name, stdio: 'pipe' });
  let output = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    if (output.length < 4_000_000) output += chunk;
  });
  // Unread pipes fill up and stall the child.
  child.stderr?.resume();
  const exited = new Promise<string>((resolve) => child.once('exit', () => resolve(output)));
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => child.on('message', (message: ToolResponse) => listener(message)),
    onExit: (listener) => child.on('exit', (code) => listener(code)),
    stdout: () => exited,
    kill: () => {
      child.kill();
    },
  };
};
