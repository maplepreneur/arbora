import { stripAnsi } from '@arbora/shared';

export interface TerminalOutputSnapshot {
  readonly output: string;
  readonly truncated: boolean;
}

/**
 * Output of one ACP terminal, ANSI-stripped and capped at `outputByteLimit` bytes (UTF-8). When the
 * cap is exceeded the oldest output is dropped at a character boundary, as the protocol requires.
 */
export class TerminalOutputBuffer {
  private text = '';
  private bytes = 0;
  private truncated = false;

  constructor(private readonly byteLimit: number | null) {}

  push(chunk: string): void {
    const clean = stripAnsi(chunk);
    this.text += clean;
    this.bytes += Buffer.byteLength(clean, 'utf8');
    if (this.byteLimit === null || this.bytes <= this.byteLimit) return;
    this.truncated = true;
    let excess = this.bytes - this.byteLimit;
    let index = 0;
    while (excess > 0 && index < this.text.length) {
      const code = this.text.codePointAt(index) ?? 0;
      const units = code > 0xffff ? 2 : 1;
      excess -= Buffer.byteLength(String.fromCodePoint(code), 'utf8');
      index += units;
    }
    this.text = this.text.slice(index);
    this.bytes = Buffer.byteLength(this.text, 'utf8');
  }

  snapshot(): TerminalOutputSnapshot {
    return { output: this.text, truncated: this.truncated };
  }
}
