// ── useGateway: WebSocket connection to Idea Canvas Gateway ──
// Manages WebSocket lifecycle, reconnection, message routing.
// Provides send/subscribe interface for generation, debate, chat, canvas.
// Falls back gracefully — if WS not connected, callers use REST+SSE.

import { useState, useEffect, useRef, useCallback } from 'react';

const WS_RECONNECT_DELAY = 2000;
const WS_MAX_RECONNECT = 5;

let msgCounter = 0;
function nextId() {
  return `msg_${++msgCounter}_${Date.now()}`;
}

export function useGateway(gatewayUrl, getToken) {
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const wsRef = useRef(null);
  const sessionIdRef = useRef(null);
  const listenersRef = useRef(new Map());
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const urlRef = useRef(gatewayUrl);
  urlRef.current = gatewayUrl;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const sessionParam = sessionIdRef.current ? `&session=${sessionIdRef.current}` : '';
    const token = getTokenRef.current?.();
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    const ws = new WebSocket(`${urlRef.current}?surface=web${sessionParam}${tokenParam}`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Handle connection message
      if (msg.type === 'connected') {
        sessionIdRef.current = msg.data?.sessionId;
        setConnected(true);
        setSessionId(msg.data?.sessionId);
        return;
      }

      // Route to request-specific listeners
      const listener = listenersRef.current.get(msg.requestId);
      if (!listener) return;

      switch (msg.type) {
        case 'node':
          listener.onNode?.(msg.data);
          break;
        case 'meta':
          listener.onMeta?.(msg.data);
          break;
        case 'progress':
          listener.onProgress?.(msg.data?.stage);
          break;
        case 'text':
          listener.onText?.(msg.data);
          break;
        case 'result':
          listener.onResult?.(msg.data);
          break;
        case 'canvas:artifact':
          listener.onCanvasArtifact?.(msg.data);
          break;
        case 'done':
          listener.onDone?.();
          listenersRef.current.delete(msg.requestId);
          break;
        case 'error':
          listener.onError?.(msg.data?.message);
          listenersRef.current.delete(msg.requestId);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Auto-reconnect
      if (reconnectCountRef.current < WS_MAX_RECONNECT) {
        reconnectCountRef.current++;
        reconnectTimerRef.current = setTimeout(connect, WS_RECONNECT_DELAY);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, []); // No dependencies — uses refs for all mutable state

  // Connect on mount
  useEffect(() => {
    if (gatewayUrl) connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [gatewayUrl, connect]);

  // Send a message and register listeners for the response stream
  const send = useCallback((type, params, handlers) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return null;

    const id = nextId();
    listenersRef.current.set(id, handlers);

    ws.send(JSON.stringify({ type, id, params }));
    return id;
  }, []);

  // Cancel an in-flight request
  const stop = useCallback((targetId) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'stop', params: { targetId } }));
    listenersRef.current.delete(targetId);
  }, []);

  return { connected, sessionId, send, stop };
}
