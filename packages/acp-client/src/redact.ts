export const REDACTED = '[redacted]';

/** Object keys whose values are secrets (matched case-insensitively against the whole key). */
const SECRET_KEY =
  /(^|_|-)(token|secret|password|passwd|apikey|api_key|authorization|credential|cookie)s?$|^(key|auth)$|apikey|api_key|secret|password|token/i;
/** Keys that look secret-ish but are protocol identifiers. */
const SAFE_KEY =
  /^(toolCallId|sessionId|optionId|methodId|terminalId|requestId|configId|messageId|compactionId|id|jsonrpc)$/;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;

function redactString(value: string): string {
  return value.replace(BEARER, `Bearer ${REDACTED}`);
}

function isNameValue(item: unknown): item is { name: string; value: unknown } {
  return typeof item === 'object' && item !== null && 'name' in item && 'value' in item;
}

/**
 * Redacts secrets from a JSON-RPC message (or any JSON value) for the ACP log viewer: values of
 * secret-looking keys, every `env`/`headers` value (both `{ NAME: value }` records and ACP's
 * `[{ name, value }]` arrays), and bearer tokens inside strings.
 */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'env' || key === 'headers') {
      out[key] = redactNamedValues(raw);
    } else if (!SAFE_KEY.test(key) && SECRET_KEY.test(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = redact(raw);
    }
  }
  return out;
}

function redactNamedValues(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return raw.map((item) => (isNameValue(item) ? { ...item, value: REDACTED } : redact(item)));
  }
  if (raw !== null && typeof raw === 'object') {
    return Object.fromEntries(Object.keys(raw as Record<string, unknown>).map((name) => [name, REDACTED]));
  }
  return redact(raw);
}
