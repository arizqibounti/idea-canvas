async function streamToSSE(res, stream) {
  let buffer = '';

  stream.on('text', (text) => {
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const node = JSON.parse(trimmed);
        res.write(`data: ${JSON.stringify(node)}\n\n`);
      } catch (e) {
        // skip non-JSON lines
      }
    }
  });

  stream.on('finalMessage', () => {
    if (buffer.trim()) {
      try {
        const node = JSON.parse(buffer.trim());
        res.write(`data: ${JSON.stringify(node)}\n\n`);
      } catch (e) { /* ignore */ }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  stream.on('error', (err) => {
    console.error('Stream error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

module.exports = { streamToSSE, sseHeaders };
