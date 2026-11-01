import type { AppSettings } from '@arbora/shared';

const REDACTED = '[redacted]';
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|auth|credential|cookie|session)/i;
const SECRET_VALUE = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxai-[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];

function redactEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.keys(env).map((key) => [key, REDACTED]));
}

/** Replaces the home folder with `~` so exported paths do not carry the user name. */
export function shortenHome(text: string, home: string): string {
  if (!home || home === '/') return text;
  return text.split(home).join('~');
}

/** Token-shaped values in free text (logs). */
export function redactText(text: string, home: string): string {
  let out = shortenHome(text, home);
  for (const pattern of SECRET_VALUE) out = out.replace(pattern, REDACTED);
  return out.replace(/((?:token|secret|password|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1${REDACTED}`);
}

/**
 * Settings as they go into a diagnostics zip: every agent env value is dropped (agents keep API
 * keys there), any key that looks like a secret is dropped, and home paths are shortened.
 */
export function redactSettings(settings: AppSettings, home: string): unknown {
  const copy: AppSettings = {
    ...settings,
    agents: {
      ...settings.agents,
      custom: settings.agents.custom.map((agent) => ({ ...agent, env: redactEnv(agent.env) })),
      env: Object.fromEntries(Object.entries(settings.agents.env).map(([id, env]) => [id, redactEnv(env)])),
    },
  };
  const walk = (value: unknown, key: string | null): unknown => {
    if (key !== null && SECRET_KEY.test(key) && typeof value === 'string') return REDACTED;
    if (typeof value === 'string') return shortenHome(value, home);
    if (Array.isArray(value)) return value.map((item) => walk(item, null));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [shortenHome(k, home), walk(v, k)]),
      );
    }
    return value;
  };
  return walk(copy, null);
}
