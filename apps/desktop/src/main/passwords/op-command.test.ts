import { describe, expect, it } from 'vitest';
import {
  loginsForOrigin,
  opCreateArgs,
  opCreateTemplate,
  opOtpArgs,
  opRevealArgs,
  revealedLogin,
} from './op-command.js';

const PASSWORD = 's3cret-fixture-value';

describe('op arguments', () => {
  it('keeps the password off argv and on the create template', () => {
    const args = opCreateArgs();
    const template = opCreateTemplate({
      title: 'Fixture',
      url: 'http://127.0.0.1:9/login',
      username: 'ada',
      password: PASSWORD,
    });
    expect(args.join(' ')).not.toContain(PASSWORD);
    expect(args).toEqual(['item', 'create', '--category', 'login', '--format', 'json']);
    expect(template).toContain(PASSWORD);
    const parsed = JSON.parse(template) as { fields: { purpose: string; value: string }[] };
    expect(parsed.fields.find((field) => field.purpose === 'PASSWORD')?.value).toBe(PASSWORD);
  });

  it('reveals by item id without putting a secret in argv', () => {
    expect(opRevealArgs('item-1').join(' ')).not.toContain(PASSWORD);
    expect(opRevealArgs('item-1')).toContain('item-1');
    expect(() => opRevealArgs('--reveal')).toThrow(/Bad 1Password item id/);
  });

  it('asks for a one-time code by item id', () => {
    expect(opOtpArgs('item-1')).toEqual(['item', 'get', 'item-1', '--otp']);
    expect(opOtpArgs('item-1').join(' ')).not.toContain(PASSWORD);
    expect(() => opOtpArgs('--otp')).toThrow(/Bad 1Password item id/);
  });

  it('reads titles for one origin and the revealed fields', () => {
    const list = JSON.stringify([
      { id: 'item-1', title: 'Fixture login', urls: [{ href: 'http://127.0.0.1:9/login' }] },
      { id: 'item-2', title: 'Other', urls: [{ href: 'https://example.com' }] },
    ]);
    expect(loginsForOrigin(list, 'http://127.0.0.1:9')).toEqual([{ id: 'item-1', title: 'Fixture login' }]);
    const revealed = revealedLogin(
      JSON.stringify([
        { label: 'username', purpose: 'USERNAME', value: 'ada' },
        { label: 'password', purpose: 'PASSWORD', value: PASSWORD },
      ]),
    );
    expect(revealed).toEqual({ username: 'ada', password: PASSWORD });
  });
});
