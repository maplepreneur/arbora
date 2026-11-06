/** One LSP JSON message, framed the way stdio servers expect. */
export function encodeLspFrame(json: string): Buffer {
  const body = Buffer.from(json, 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]);
}

/** Pulls JSON bodies out of a stdio byte stream. Headers other than Content-Length are ignored. */
export class LspFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return messages;
      const header = this.buffer.toString('ascii', 0, headerEnd);
      const match = /Content-Length: (\d+)/i.exec(header);
      const length = match?.[1] ? Number(match[1]) : null;
      if (length === null || !Number.isInteger(length) || length < 0) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return messages;
      messages.push(this.buffer.toString('utf8', start, start + length));
      this.buffer = this.buffer.subarray(start + length);
    }
  }
}
