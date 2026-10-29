import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';
import { serveStatic } from './static.js';
import { createStore } from './store.js';
import { sendError } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * Cria a aplicação HTTP sem abrir porta (bom para testes).
 * @param {{dataDir?: string, publicDir?: string}} [options]
 */
export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data');
  const publicDir = options.publicDir || path.join(ROOT, 'public');
  const store = createStore({ dataDir });
  const api = createApi(store);

  const handler = async (req, res) => {
    const started = Date.now();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const isApi = url.pathname.startsWith('/api/');

    res.on('finish', () => {
      if (!isApi) return;
      const elapsed = Date.now() - started;
      const quiet = req.method === 'GET' && res.statusCode < 400 && !url.pathname.endsWith('/health');
      if (!quiet) {
        console.log(`[rasec] ${req.method} ${url.pathname} ${res.statusCode} ${elapsed}ms`);
      }
    });

    try {
      if (isApi) {
        await api(req, res, url);
      } else {
        serveStatic(req, res, url, publicDir);
      }
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendError(res, error);
    }
  };

  return { handler, store, dataDir, publicDir };
}

function lanAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return [...new Set(addresses)];
}

/**
 * Cria o servidor HTTP ou HTTPS conforme TLS_CERT/TLS_KEY.
 * @param {import('node:http').RequestListener} handler
 */
function createHttpServer(handler) {
  const certPath = process.env.TLS_CERT;
  const keyPath = process.env.TLS_KEY;
  if (!certPath && !keyPath) {
    return { server: http.createServer(handler), protocol: 'http' };
  }
  if (!certPath || !keyPath) {
    throw new Error('Defina TLS_CERT e TLS_KEY juntos para habilitar HTTPS.');
  }
  try {
    const options = {
      cert: fs.readFileSync(path.resolve(certPath)),
      key: fs.readFileSync(path.resolve(keyPath)),
    };
    return { server: https.createServer(options, handler), protocol: 'https' };
  } catch (error) {
    throw new Error(`Não foi possível ler o certificado HTTPS: ${error.message}`);
  }
}

/**
 * Sobe o servidor HTTP (ou HTTPS, se TLS_CERT/TLS_KEY estiverem definidos).
 * @param {{port?: number, host?: string, dataDir?: string, publicDir?: string}} [options]
 */
export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const host = options.host || process.env.HOST || '0.0.0.0';
  const app = createApp(options);

  let created;
  try {
    created = createHttpServer(app.handler);
  } catch (error) {
    console.error(`\n[rasec] ${error.message}\n`);
    process.exitCode = 1;
    return { ...app, server: null, protocol: null };
  }
  const { server, protocol } = created;

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n[rasec] A porta ${port} ja esta em uso. Feche o outro servidor ou use outra porta:`);
      console.error(`        $env:PORT=3001; npm start\n`);
    } else {
      console.error('[rasec] erro no servidor:', error);
    }
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const addresses = lanAddresses();
    const lines = [];
    lines.push('');
    lines.push('  ██████╗  █████╗ ███████╗███████╗ ██████╗');
    lines.push('  ██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝');
    lines.push('  ██████╔╝███████║███████╗█████╗  ██║     ');
    lines.push('  ██╔══██╗██╔══██║╚════██║██╔══╝  ██║     ');
    lines.push('  ██║  ██║██║  ██║███████║███████╗╚██████╗');
    lines.push('  ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝');
    lines.push('');
    lines.push('  Rasec - Espetinhos • Feira de Empreendedorismo C.E.P.K');
    lines.push(`  Local:   ${protocol}://localhost:${port}`);
    for (const address of addresses) lines.push(`  Rede:    ${protocol}://${address}:${port}`);
    lines.push(`  Dados:   ${app.store.file}`);
    if (app.store.seeded) {
      lines.push('');
      lines.push('  Primeiro acesso (contas da equipe):');
      lines.push('    bruno, bruna, eduardo, julia, endrick, kaua, jhonathan');
      lines.push(`    senha inicial: ${app.store.defaultPassword}`);
      lines.push('    Troque a senha em Perfil depois do primeiro login.');
    }
    lines.push('');
    console.log(lines.join('\n'));
  });

  function shutdown(signal) {
    console.log(`\n[rasec] ${signal} recebido, encerrando...`);
    server.close(() => {
      try {
        app.store.save();
      } catch (error) {
        console.error('[rasec] falha ao salvar dados:', error.message);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 4000).unref();
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return { server, protocol, ...app };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) startServer();
