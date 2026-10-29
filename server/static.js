import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const CACHE = {
  '.woff2': 'public, max-age=31536000, immutable',
  '.svg': 'public, max-age=3600',
  '.png': 'public, max-age=3600',
  '.css': 'public, max-age=300',
  '.js': 'public, max-age=300',
};

function notFound(res) {
  const body = '404 - arquivo nao encontrado';
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function serveStatic(req, res, url, publicDir) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Metodo nao permitido');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    notFound(res);
    return;
  }

  const relative = pathname.replace(/^\/+/, '');
  const candidate = path.resolve(publicDir, relative || 'index.html');
  const root = path.resolve(publicDir);

  // Impede path traversal e acesso a arquivos ocultos.
  if (!candidate.startsWith(root + path.sep) || relative.split(/[\\/]/).some((part) => part.startsWith('.'))) {
    notFound(res);
    return;
  }

  let file = candidate;
  let stat;
  try {
    stat = fs.statSync(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = fs.statSync(file);
    }
  } catch {
    // Rotas do SPA (sem extensão) caem no index.html.
    if (!path.extname(relative) && String(req.headers.accept || '').includes('text/html')) {
      file = path.join(root, 'index.html');
      try {
        stat = fs.statSync(file);
      } catch {
        notFound(res);
        return;
      }
    } else {
      notFound(res);
      return;
    }
  }

  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const isServiceWorker = relative === 'sw.js';
  const headers = {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': isServiceWorker ? 'no-cache' : ext === '.html' ? 'no-cache' : CACHE[ext] || 'public, max-age=300',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] });
    res.end();
    return;
  }

  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}
