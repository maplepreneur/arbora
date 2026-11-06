/** Arguments for `op`. Secrets go on stdin, never in this list. */

export function opListArgs(): readonly string[] {
  return ['item', 'list', '--categories', 'Login', '--format', 'json'];
}

export function opRevealArgs(id: string): readonly string[] {
  assertItemId(id);
  return ['item', 'get', id, '--fields', 'username,password', '--reveal', '--format', 'json'];
}

export function opOtpArgs(id: string): readonly string[] {
  assertItemId(id);
  return ['item', 'get', id, '--otp'];
}

export function opCreateArgs(): readonly string[] {
  return ['item', 'create', '--category', 'login', '--format', 'json'];
}

export function opVersionArgs(): readonly string[] {
  return ['--version'];
}

/** JSON template for `op item create`. The password lives only in this string. */
export function opCreateTemplate(input: {
  readonly title: string;
  readonly url: string;
  readonly username: string;
  readonly password: string;
}): string {
  return JSON.stringify({
    title: input.title,
    category: 'LOGIN',
    urls: [{ href: input.url, primary: true }],
    fields: [
      { id: 'username', label: 'username', purpose: 'USERNAME', type: 'STRING', value: input.username },
      { id: 'password', label: 'password', purpose: 'PASSWORD', type: 'CONCEALED', value: input.password },
    ],
  });
}

export function assertItemId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new Error('Bad 1Password item id');
}

export interface LoginSummary {
  readonly id: string;
  readonly title: string;
}

export interface RevealedLogin {
  readonly username: string;
  readonly password: string;
}

/** `op item list` rows whose URL matches `origin`. Titles and ids only. */
export function loginsForOrigin(stdout: string, origin: string): LoginSummary[] {
  const rows = parseJson(stdout);
  if (!Array.isArray(rows)) return [];
  const out: LoginSummary[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { id?: unknown; title?: unknown; urls?: unknown };
    if (typeof record.id !== 'string' || typeof record.title !== 'string') continue;
    const urls = Array.isArray(record.urls) ? record.urls : [];
    const matches = urls.some((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const href = (entry as { href?: unknown }).href;
      return typeof href === 'string' && hrefOrigin(href) === origin;
    });
    if (matches) out.push({ id: record.id, title: record.title });
  }
  return out;
}

/** Username and password from `op item get --fields username,password --reveal`. */
export function revealedLogin(stdout: string): RevealedLogin {
  const parsed = parseJson(stdout);
  const fields = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { fields?: unknown }).fields)
      ? (parsed as { fields: unknown[] }).fields
      : [];
  let username = '';
  let password = '';
  for (const field of fields) {
    if (!field || typeof field !== 'object') continue;
    const record = field as { label?: unknown; purpose?: unknown; id?: unknown; value?: unknown };
    const name = `${textOf(record.purpose)} ${textOf(record.label)} ${textOf(record.id)}`.toLowerCase();
    const value = typeof record.value === 'string' ? record.value : '';
    if (name.includes('password')) password = value;
    else if (name.includes('username') || name.includes('email')) username = value;
  }
  return { username, password };
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function hrefOrigin(href: string): string | null {
  try {
    return new URL(href).origin;
  } catch {
    return null;
  }
}
