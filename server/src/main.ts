import { SERVER_PORT, GAME_WS_PATH, CHAT_WS_PATH } from '@projectrs/shared';
import { resolve } from 'path';
import { statSync, readFileSync } from 'fs';

const CLIENT_DIST = resolve(import.meta.dir, '../../client/dist');

// MIME type lookup
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveStatic(pathname: string): Response | null {
  let filePath = resolve(CLIENT_DIST, pathname.startsWith('/') ? pathname.slice(1) : pathname);

  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      filePath = resolve(filePath, 'index.html');
    }
  } catch {
    // Try index.html for SPA routing
    filePath = resolve(CLIENT_DIST, 'index.html');
  }

  try {
    const content = readFileSync(filePath);
    return new Response(content, {
      headers: { 'Content-Type': getMimeType(filePath) },
    });
  } catch {
    return null;
  }
}

const server = Bun.serve({
  port: SERVER_PORT,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for game socket
    if (url.pathname === GAME_WS_PATH) {
      const upgraded = server.upgrade(req, { data: { type: 'game' } });
      if (upgraded) return undefined as unknown as Response;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // WebSocket upgrade for chat socket
    if (url.pathname === CHAT_WS_PATH) {
      const upgraded = server.upgrade(req, { data: { type: 'chat' } });
      if (upgraded) return undefined as unknown as Response;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Serve static client files
    const response = serveStatic(url.pathname);
    if (response) return response;

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      const type = (ws.data as { type: string }).type;
      console.log(`[${type}] Client connected`);
    },
    message(ws, message) {
      const type = (ws.data as { type: string }).type;
      console.log(`[${type}] Message received:`, message);
    },
    close(ws) {
      const type = (ws.data as { type: string }).type;
      console.log(`[${type}] Client disconnected`);
    },
  },
});

console.log(`ProjectRS server running on http://localhost:${server.port}`);
console.log(`Game WebSocket: ws://localhost:${server.port}${GAME_WS_PATH}`);
console.log(`Chat WebSocket: ws://localhost:${server.port}${CHAT_WS_PATH}`);
