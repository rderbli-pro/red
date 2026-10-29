/**
 * Utilidades HTTP e de validação compartilhadas pela API.
 */

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {string} [code]
   * @param {Record<string, string>} [fields]
   */
  constructor(status, message, code = 'error', fields) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** @param {import('node:http').ServerResponse} res */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** @param {import('node:http').ServerResponse} res */
export function sendError(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      error: error.message,
      code: error.code,
      ...(error.fields ? { fields: error.fields } : {}),
    });
    return;
  }
  console.error('[rasec] erro inesperado:', error);
  sendJson(res, 500, {
    error: 'Algo deu errado no servidor. Tente novamente.',
    code: 'internal_error',
  });
}

/**
 * Lê e valida o corpo JSON.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 */
export function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Corpo da requisição muito grande.', 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new HttpError(400, 'Envie um objeto JSON válido.', 'invalid_json'));
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'JSON inválido.', 'invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

export function getIp(req) {
  return req.socket?.remoteAddress || 'desconhecido';
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return getIp(req);
}

export function nowIso() {
  return new Date().toISOString();
}

/** Data local do servidor no formato AAAA-MM-DD. */
export function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isSameLocalDay(iso, reference = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

export function centsToBRL(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function validateText(value, { field, label, min = 1, max = 80, required = true }) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${label} é obrigatório.`, 'validation_error', { [field]: `Informe ${label.toLowerCase()}.` });
    return '';
  }
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text && required) {
    throw new HttpError(400, `${label} é obrigatório.`, 'validation_error', { [field]: `Informe ${label.toLowerCase()}.` });
  }
  if (text.length < min) {
    throw new HttpError(400, `${label} deve ter pelo menos ${min} caracteres.`, 'validation_error', {
      [field]: `Mínimo de ${min} caracteres.`,
    });
  }
  if (text.length > max) {
    throw new HttpError(400, `${label} deve ter no máximo ${max} caracteres.`, 'validation_error', {
      [field]: `Máximo de ${max} caracteres.`,
    });
  }
  return text;
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,19}$/;

export function validateUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Usuário inválido. Use 3 a 20 caracteres: letras, números, ponto, hífen ou _.', 'validation_error', {
      username: 'Ex.: bruno, bruna.s, kaua-2',
    });
  }
  return username;
}

export function validatePassword(value, field = 'password') {
  const password = String(value ?? '');
  if (password.length < 6) {
    throw new HttpError(400, 'A senha deve ter pelo menos 6 caracteres.', 'validation_error', {
      [field]: 'Mínimo de 6 caracteres.',
    });
  }
  if (password.length > 100) {
    throw new HttpError(400, 'A senha é longa demais.', 'validation_error', { [field]: 'Máximo de 100 caracteres.' });
  }
  return password;
}

/** Garante inteiro dentro do intervalo; aceita string numérica. */
export function toInt(value, { min, max, field, label }) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new HttpError(400, `${label} inválido.`, 'validation_error', { [field]: 'Use um número inteiro.' });
  }
  if (number < min || number > max) {
    throw new HttpError(400, `${label} deve ficar entre ${min} e ${max}.`, 'validation_error', {
      [field]: `Intervalo: ${min} a ${max}.`,
    });
  }
  return number;
}

export function csvCell(value) {
  const text = String(value ?? '');
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
