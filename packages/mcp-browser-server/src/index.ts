/**
 * MCP server exposing Arbora's browser and dev-server tools to agents (Stage 5). Electron-free:
 * the app supplies a `BrowserToolHost` and a CDP connection.
 */
export { ToolError, type Cdp } from './cdp.js';
export type {
  BrowserToolHost,
  DevServerInfo,
  GuardedTool,
  LogEntry,
  LogLevel,
  PageInfo,
  PermissionRequest,
  ScreenshotImage,
  ScreenshotMode,
  TerminalRunResult,
  ToolPolicy,
  ViewportPreset,
  ViewportRequest,
} from './host.js';
export type { Box } from './input.js';
export { callOnElement } from './refs.js';
export {
  BrowserMcpServer,
  MCP_PATH,
  MCP_SERVER_NAME,
  SHIM_TOKEN_ENV,
  type McpActivity,
  type McpEndpoint,
} from './server.js';
export { formatSnapshot, type AxNode, type Snapshot } from './snapshot.js';
