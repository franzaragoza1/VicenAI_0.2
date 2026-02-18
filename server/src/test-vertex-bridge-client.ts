import WebSocket from 'ws';

async function main() {
  const ws = new WebSocket('ws://localhost:8081/gemini');

  ws.on('open', () => {
    process.stdout.write('open\n');
    ws.send(JSON.stringify({ type: 'setup', systemInstruction: 'Eres un test' }));
  });

  ws.on('message', (data) => {
    const raw = data.toString();
    process.stdout.write(`MSG ${raw}\n`);
    try {
      const msg = JSON.parse(raw);
      if (msg?.type === 'connected') {
        ws.send(JSON.stringify({ type: 'text_turn', text: 'Responde solo con la palabra: ok', turnComplete: true }));
      }
    } catch {}
  });

  ws.on('error', (err) => {
    process.stderr.write(`ERR ${err instanceof Error ? err.message : String(err)}\n`);
  });

  ws.on('close', (code, reason) => {
    process.stdout.write(`CLOSE ${code} ${reason.toString()}\n`);
    process.exit(0);
  });

  setTimeout(() => {
    try {
      ws.close(1000, 'done');
    } catch {}
  }, 8000);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
