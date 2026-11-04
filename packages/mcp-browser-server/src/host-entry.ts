/**
 * What the app needs before any agent session exists, without the MCP SDK: the host contract,
 * errors, element helpers and names. `BrowserMcpServer` (the SDK and its Zod builds, ~570 KB)
 * stays in the main entry and is loaded when the first agent session starts.
 */
export { ToolError, type Cdp } from './cdp.js';
export { MCP_PATH, MCP_SERVER_NAME, SHIM_TOKEN_ENV } from './constants.js';
export type {
  GroveAgent,
  GroveSession,
  GroveStartRequest,
  GroveStatus,
  GroveToolHost,
  GroveWaitRequest,
} from './grove-host.js';
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
export type { McpActivity, McpEndpoint } from './server.js';
