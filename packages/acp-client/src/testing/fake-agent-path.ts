import { fileURLToPath } from 'node:url';

/** Absolute path of the fake agent script, for `node <path>` in tests and e2e. */
export const FAKE_AGENT_PATH = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));
