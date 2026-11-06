/**
 * A stdio language server for the editor e2e. It answers initialize, hover, definition and
 * completion, and ignores everything else. Arbora spawns it with Electron as Node.
 */
let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.toString('ascii', 0, headerEnd);
    const match = /Content-Length: (\d+)/i.exec(header);
    const length = match ? Number(match[1]) : null;
    if (length === null) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(buffer.toString('utf8', start, start + length));
    buffer = buffer.subarray(start + length);
    respond(message);
  }
});

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
  process.stdout.write(body);
}

function respond(message) {
  if (!message || typeof message !== 'object' || message.id === undefined || !message.method) return;
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        capabilities: {
          hoverProvider: true,
          definitionProvider: true,
          completionProvider: { triggerCharacters: ['.'] },
        },
      },
    });
    return;
  }
  if (message.method === 'textDocument/hover') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { contents: { kind: 'markdown', value: 'lsp-hover-ok' } },
    });
    return;
  }
  if (message.method === 'textDocument/definition') {
    const uri = message.params?.textDocument?.uri;
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        uri,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      },
    });
    return;
  }
  if (message.method === 'textDocument/completion') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { isIncomplete: false, items: [{ label: 'lspComplete' }] },
    });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, result: null });
}
