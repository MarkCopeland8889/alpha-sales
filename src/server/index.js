// Local web server: serves the control panel (ui/) and the API, and streams live events
// (logs, sessions, runs, human requests) to the panel over a WebSocket.
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from '../core/env.js';
import { PATHS } from '../core/paths.js';
import { logger } from '../core/logbook.js';
import { onEvent } from '../core/events.js';
import { completeGoogleLogin } from '../auth/session.js';
import { onLogin } from '../engine.js';
import { api } from './routes.js';
import { guard, hostAllowed, apiToken } from './security.js';

const log = logger('server');

export function startServer({ port = config.port, host = config.host } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(guard);
  app.use(express.json({ limit: '25mb' }));

  // Google login redirect target (Supabase sends ?code=...).
  app.get('/auth/callback', async (req, res) => {
    try {
      if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
      const user = await completeGoogleLogin(String(req.query.code || ''));
      await onLogin(user);
      res.redirect('/');
    } catch (err) {
      log.fail('Google login failed', err);
      res.redirect(`/?loginError=${encodeURIComponent(err.message)}`);
    }
  });

  app.use('/api', api);
  app.use(express.static(PATHS.ui, { index: 'index.html', extensions: ['html'] }));
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws' || !hostAllowed(req) || url.searchParams.get('token') !== apiToken()) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  onEvent((e) => {
    const msg = JSON.stringify(e);
    for (const client of wss.clients) if (client.readyState === 1) client.send(msg);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log.ok(`Control panel: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
      resolve(server);
    });
  });
}
