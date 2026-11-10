/**
 * Persistência externa no Firebase Realtime Database usando apenas a API REST.
 *
 * Não usamos o SDK do Firebase para manter o projeto sem dependências.
 * A autenticação é feita com uma conta de serviço (JWT RS256 -> access token)
 * e o banco inteiro é gravado em um único nó (por padrão, `rasec/db`).
 *
 * Variáveis de ambiente:
 *  - FIREBASE_DATABASE_URL            URL do Realtime Database.
 *  - FIREBASE_SERVICE_ACCOUNT         JSON da conta de serviço (uma linha).
 *  - FIREBASE_SERVICE_ACCOUNT_BASE64  JSON da conta de serviço em Base64.
 *  - FIREBASE_SERVICE_ACCOUNT_FILE    Caminho do JSON da conta de serviço.
 *  - GOOGLE_APPLICATION_CREDENTIALS   Alternativa ao arquivo acima.
 *  - FIREBASE_DB_PATH                 Nó do banco (padrão: `rasec/db`).
 */
import { createSign } from 'node:crypto';
import fs from 'node:fs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
const REQUEST_TIMEOUT_MS = 10_000;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function normalizeDatabaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

function normalizeDatabasePath(raw) {
  const value = String(raw || 'rasec/db')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.json$/i, '');
  return value || 'rasec/db';
}

function readServiceAccount(env) {
  const base64 = String(env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();
  if (base64) {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  }

  const inline = String(env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (inline) return JSON.parse(inline);

  const file =
    env.FIREBASE_SERVICE_ACCOUNT_FILE || env.GOOGLE_APPLICATION_CREDENTIALS || '';
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));

  return null;
}

function prepareServiceAccount(account) {
  if (!account || typeof account !== 'object') {
    throw new Error('A conta de serviço do Firebase não é um objeto JSON válido.');
  }
  if (!account.client_email || !account.private_key) {
    throw new Error('A conta de serviço precisa ter client_email e private_key.');
  }
  return {
    ...account,
    // Ao colar o JSON em uma variável de ambiente, as quebras de linha podem
    // chegar como "\n" literais. Normalizamos antes de assinar.
    private_key: String(account.private_key).replace(/\\n/g, '\n'),
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cria o backend do Firebase a partir do ambiente.
 * Se nenhuma variável estiver definida, retorna `{ enabled: false }`.
 * Se a configuração estiver incompleta, falha cedo com uma mensagem clara.
 */
export function createFirebaseBackend(env = process.env) {
  const databaseUrl = normalizeDatabaseUrl(
    env.FIREBASE_DATABASE_URL || env.FIREBASE_DB_URL,
  );
  const hasCredentials = Boolean(
    env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
      env.FIREBASE_SERVICE_ACCOUNT ||
      env.FIREBASE_SERVICE_ACCOUNT_FILE ||
      env.GOOGLE_APPLICATION_CREDENTIALS,
  );

  if (!databaseUrl && !hasCredentials) return { enabled: false };
  if (!databaseUrl) {
    throw new Error(
      'Firebase: defina FIREBASE_DATABASE_URL (a URL do Realtime Database).',
    );
  }
  if (!hasCredentials) {
    throw new Error(
      'Firebase: defina FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_SERVICE_ACCOUNT ' +
        'ou FIREBASE_SERVICE_ACCOUNT_FILE com a conta de serviço.',
    );
  }

  let account;
  try {
    account = prepareServiceAccount(readServiceAccount(env));
  } catch (error) {
    throw new Error(`Firebase: não foi possível ler a conta de serviço. ${error.message}`);
  }

  const databasePath = normalizeDatabasePath(env.FIREBASE_DB_PATH);
  const endpoint = `${databaseUrl}/${databasePath}.json`;

  /** @type {{value: string, expiresAt: number}|null} */
  let cachedToken = null;

  function signAssertion() {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: SCOPES,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    );
    const unsigned = `${header}.${claims}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(account.private_key)
      .toString('base64url');
    return `${unsigned}.${signature}`;
  }

  async function getAccessToken(forceRefresh = false) {
    if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.value;
    }

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signAssertion(),
    });

    let response;
    try {
      response = await fetchWithTimeout(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (error) {
      throw new Error(`Firebase: falha ao contatar o Google OAuth (${error.message}).`);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(
        `Firebase: o Google recusou a conta de serviço (${response.status}). ${detail}`.trim(),
      );
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('Firebase: o Google não devolveu um access token.');
    }

    const ttl = Math.max(60, Number(data.expires_in) || 3600) * 1000;
    cachedToken = {
      value: data.access_token,
      // Renova um pouco antes de expirar.
      expiresAt: Date.now() + ttl - 60_000,
    };
    return cachedToken.value;
  }

  async function request(method, body, retry = true) {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetchWithTimeout(endpoint, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Firebase: falha de rede ao ${method} (${error.message}).`);
    }

    if (response.status === 401 && retry) {
      cachedToken = null;
      return request(method, body, false);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Firebase: ${method} devolveu ${response.status}. ${detail}`.trim());
    }

    // PUT devolve o valor gravado; não precisamos dele.
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return {
    enabled: true,
    databaseUrl,
    databasePath,
    endpoint,

    /** Lê o banco remoto. Retorna `null` quando o nó ainda não existe. */
    async load() {
      return request('GET');
    },

    /** Grava o banco inteiro no nó configurado. */
    async save(database) {
      await request('PUT', database);
      return true;
    },

    /** Testa credencial e acesso sem alterar nada. */
    async ping() {
      await getAccessToken();
      return true;
    },
  };
}
