/** The message of an error thrown by a main handler, without Electron's `Error invoking remote method` prefix. */
export function ipcError(error: unknown): string {
  return (error as Error).message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}
