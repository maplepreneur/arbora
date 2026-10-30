/**
 * Entry point of the stdio shim, bundled as `out/main/mcp-shim.js` and run by agents as
 * `<arbora executable> mcp-shim.js <url>` with `ELECTRON_RUN_AS_NODE=1` and the token in the env.
 */
import { runShim, SHIM_TOKEN_ENV } from './shim.js';

const url = process.argv[2];
const token = process.env[SHIM_TOKEN_ENV];
if (!url || !token) {
  process.stderr.write(`usage: mcp-shim <url> (with ${SHIM_TOKEN_ENV} set)\n`);
  process.exit(2);
}
runShim(url, token).catch((error: unknown) => {
  process.stderr.write(`[arbora-mcp-shim] ${(error as Error).message}\n`);
  process.exit(1);
});
