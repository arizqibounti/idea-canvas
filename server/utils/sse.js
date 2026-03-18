async function streamToSSE(res, stream) {
  let buffer = '';
  let ended = false;

  // Abort the Anthropic stream when client disconnects (e.g. user clicks Stop)
  res.on('close', () => {
    if (!ended) {
      ended = true;
      try { stream.abort(); } catch (e) { /* already done */ }
    }
  });

  stream.on('text', (text) => {
    if (ended) return;
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
    if (ended) return;
    ended = true;
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
    if (ended) return;
    ended = true;
    console.error('Stream error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });
}

/**
 * Stream to SSE AND collect all parsed nodes.
 * Does NOT send [DONE] or end the response — caller must do that.
 * Returns array of collected node objects.
 */
async function streamToSSECollect(res, stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let ended = false;
    const collected = [];

    // Abort the Anthropic stream when client disconnects
    res.on('close', () => {
      if (!ended) {
        ended = true;
        try { stream.abort(); } catch (e) { /* already done */ }
        resolve(collected); // resolve with whatever we collected so far
      }
    });

    stream.on('text', (text) => {
      if (ended) return;
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const node = JSON.parse(trimmed);
          res.write(`data: ${JSON.stringify(node)}\n\n`);
          if (!node._meta && !node._progress) collected.push(node);
        } catch (e) {
          // skip non-JSON lines
        }
      }
    });

    stream.on('finalMessage', () => {
      if (ended) return;
      ended = true;
      if (buffer.trim()) {
        try {
          const node = JSON.parse(buffer.trim());
          res.write(`data: ${JSON.stringify(node)}\n\n`);
          if (!node._meta && !node._progress) collected.push(node);
        } catch (e) { /* ignore */ }
      }
      resolve(collected);
    });

    stream.on('error', (err) => {
      if (ended) return;
      ended = true;
      console.error('Stream error:', err);
      reject(err);
    });
  });
}

/**
 * Parse a non-streamed message response into node objects.
 * Handles both single-text and multi-text content blocks.
 */
function parseMessageToNodes(message) {
  const text = message.content.map(c => c.text || '').join('\n');
  const nodes = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const node = JSON.parse(trimmed);
      if (!node._meta) nodes.push(node);
    } catch (e) { /* skip */ }
  }
  return nodes;
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

/**
 * Stream Gemini async-iterator response to SSE.
 * Gemini generateContentStream returns an async iterable of chunks.
 */
async function geminiStreamToSSE(res, geminiStream) {
  let buffer = '';
  try {
    for await (const chunk of geminiStream) {
      const text = chunk.text || '';
      if (!text) continue;

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
    }
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const node = JSON.parse(buffer.trim());
        res.write(`data: ${JSON.stringify(node)}\n\n`);
      } catch (e) { /* ignore */ }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Gemini stream error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

/**
 * Create an AbortController that aborts when the client disconnects.
 * Attach to req so handlers can pass signal to AI calls.
 */
function attachAbortSignal(req, res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });
  req.signal = controller.signal;
  return controller;
}

/**
 * Unified stream-to-SSE dispatcher. Picks the right streamer based on provider.
 * Works with the { stream, provider } return value from ai.stream().
 */
async function autoStreamToSSE(res, { stream, provider }) {
  if (provider === 'gemini') {
    return geminiStreamToSSE(res, stream);
  }
  return streamToSSE(res, stream);
}

module.exports = { streamToSSE, streamToSSECollect, parseMessageToNodes, sseHeaders, geminiStreamToSSE, attachAbortSignal, autoStreamToSSE };
