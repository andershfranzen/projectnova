import { SERVER_PORT, GAME_WS_PATH, CHAT_WS_PATH } from '@projectrs/shared';
import { resolve } from 'path';
import { statSync, readFileSync } from 'fs';
import { World } from './World';
import { GameDatabase } from './Database';
import {
  handleGameSocketOpen,
  handleGameSocketMessage,
  handleGameSocketClose,
  type GameSocketData,
} from './network/GameSocket';
import {
  handleChatSocketOpen,
  handleChatSocketMessage,
  handleChatSocketClose,
  type ChatSocketData,
} from './network/ChatSocket';

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

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Create database and game world
const db = new GameDatabase();
const world = new World(db);
world.start();

// Clean expired sessions every 10 minutes
setInterval(() => db.cleanExpiredSessions(), 10 * 60 * 1000);

type SocketData = GameSocketData | ChatSocketData;

const server = Bun.serve<SocketData>({
  port: SERVER_PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // --- REST Auth Endpoints ---

    if (url.pathname === '/api/signup' && req.method === 'POST') {
      try {
        const body = await req.json() as { username?: string; password?: string };
        const result = await db.createAccount(body.username || '', body.password || '');
        if (result.ok) {
          return jsonResponse({ ok: true, token: result.token, username: body.username });
        }
        return jsonResponse({ ok: false, error: result.error }, 400);
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid request' }, 400);
      }
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      try {
        const body = await req.json() as { username?: string; password?: string };
        const result = await db.login(body.username || '', body.password || '');
        if (result.ok) {
          return jsonResponse({ ok: true, token: result.token, username: result.username });
        }
        return jsonResponse({ ok: false, error: result.error }, 400);
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid request' }, 400);
      }
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      try {
        const body = await req.json() as { token?: string };
        if (body.token) db.logout(body.token);
        return jsonResponse({ ok: true });
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid request' }, 400);
      }
    }

    // --- WebSocket Upgrades (with token auth) ---

    if (url.pathname === GAME_WS_PATH) {
      const token = url.searchParams.get('token');
      const session = token ? db.getSession(token) : null;
      if (!session) {
        return new Response('Unauthorized', { status: 401 });
      }
      const upgraded = server.upgrade(req, {
        data: { type: 'game', accountId: session.accountId, username: session.username } as GameSocketData,
      });
      if (upgraded) return undefined as unknown as Response;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    if (url.pathname === CHAT_WS_PATH) {
      const token = url.searchParams.get('token');
      const session = token ? db.getSession(token) : null;
      if (!session) {
        return new Response('Unauthorized', { status: 401 });
      }
      const upgraded = server.upgrade(req, {
        data: { type: 'chat', accountId: session.accountId, username: session.username } as ChatSocketData,
      });
      if (upgraded) return undefined as unknown as Response;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // --- Static File Serving ---

    const response = serveStatic(url.pathname);
    if (response) return response;

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws: import('bun').ServerWebSocket<SocketData>) {
      if (ws.data.type === 'game') {
        handleGameSocketOpen(ws as any, world);
      } else {
        handleChatSocketOpen(ws as any, world);
      }
    },
    message(ws: import('bun').ServerWebSocket<SocketData>, message: string | Buffer) {
      if (ws.data.type === 'game') {
        const buf = message instanceof ArrayBuffer ? message : (message as unknown as Buffer).buffer.slice(0) as ArrayBuffer;
        handleGameSocketMessage(ws as any, buf, world);
      } else {
        handleChatSocketMessage(ws as any, String(message), world);
      }
    },
    close(ws: import('bun').ServerWebSocket<SocketData>) {
      if (ws.data.type === 'game') {
        handleGameSocketClose(ws as any, world);
      } else {
        handleChatSocketClose(ws as any, world);
      }
    },
  },
});

console.log(`ProjectRS server running on http://localhost:${server.port}`);
console.log(`Game WebSocket: ws://localhost:${server.port}${GAME_WS_PATH}`);
console.log(`Chat WebSocket: ws://localhost:${server.port}${CHAT_WS_PATH}`);
console.log(`World tick rate: ${600}ms — ${world.players.size} players online`);
