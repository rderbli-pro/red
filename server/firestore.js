/**
 * Persistência externa no Google Cloud Firestore usando apenas a API REST.
 *
 * Não usamos o SDK do Firebase para manter o projeto sem dependências.
 * A autenticação é feita com uma conta de serviço (JWT RS256 -> access token).
 *
 * O banco inteiro é dividido em documentos, evitando o limite de 1 MiB:
 *  - `rasec/meta`          -> meta (version, createdAt, settings, counters)
 *  - `rasec_users/{id}`    -> um documento por usuário
 *  - `rasec_products/{id}` -> um documento por produto
 *  - `rasec_orders/{id}`   -> um documento por pedido
 *  - `rasec_sessions/{id}` -> um documento por sessão
 *
 * Variáveis de ambiente:
 *  - FIRESTORE_ENABLED                 "false" desliga o Firestore mesmo com credencial.
 *  - FIRESTORE_SERVICE_ACCOUNT         JSON da conta de serviço (uma linha).
 *  - FIRESTORE_SERVICE_ACCOUNT_BASE64  JSON da conta de serviço em Base64.
 *  - FIRESTORE_SERVICE_ACCOUNT_FILE    Caminho do JSON da conta de serviço.
 *  - GOOGLE_APPLICATION_CREDENTIALS    Alternativa ao arquivo acima.
 *  - FIRESTORE_COLLECTION              Coleção raiz (padrão: `rasec`).
 *  - FIRESTORE_COLLECTIONS             Coleções a sincronizar (padrão: users,products,orders,sessions).
 *
 * Sem nenhuma variável, tenta automaticamente o arquivo padrão na raiz do
 * projeto (`firestoreSecretKey.json`). Se ele não existir, roda em modo local.
 */
import { createSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = ['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/cloud-platform'].join(' ');
const REQUEST_TIMEOUT_MS = 10_000;
const COMMIT_BATCH_LIMIT = 400; // Firestore aceita até 500 escritas por commit.
const DEFAULT_KEY_FILE = 'firestoreSecretKey.json';
const DEFAULT_COLLECTION = 'rasec';
const DEFAULT_COLLECTIONS = ['users', 'products', 'orders', 'sessions'];

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function readServiceAccount(env) {
  const base64 = String(env.FIRESTORE_SERVICE_ACCOUNT_BASE64 || '').trim();
  if (base64) {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  }

  const inline = String(env.FIRESTORE_SERVICE_ACCOUNT || '').trim();
  if (inline) return JSON.parse(inline);

  const file =
    env.FIRESTORE_SERVICE_ACCOUNT_FILE ||
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    '';

  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));

  // Fallback: credencial padrão na raiz do projeto.
  const defaultFile = path.resolve(
    process.cwd(),
    env.FIRESTORE_KEY_FILE || DEFAULT_KEY_FILE,
  );
  if (fs.existsSync(defaultFile)) {
    return JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
  }

  return null;
}

function prepareServiceAccount(account) {
  if (!account || typeof account !== 'object') {
    throw new Error('A conta de serviço do Firestore não é um objeto JSON válido.');
  }
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error('A conta de serviço precisa ter project_id, client_email e private_key.');
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

/* ------------------------------------------------------------------ *
 * Codificação JS -> Firestore (formato `Value`) e de volta.
 * ------------------------------------------------------------------ */

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => encodeValue(item)) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new Error(`Firestore: tipo não suportado (${typeof value}).`);
}

function encodeFields(object) {
  /** @type {Record<string, any>} */
  const fields = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    fields[key] = encodeValue(value);
  }
  return fields;
}

/** Converte um `Value` do Firestore (`{ mapValue: ... }`) em JS. */
function decodeValue(field) {
  const key = Object.keys(field || {})[0];
  if (!key) return null;
  const value = field[key];
  switch (key) {
    case 'nullValue':
      return null;
    case 'booleanValue':
    case 'stringValue':
    case 'doubleValue':
    case 'bytesValue':
      return value;
    case 'integerValue':
      return Number(value);
    case 'mapValue':
      return decodeFields(value.fields || {});
    case 'arrayValue':
      return (value.values || []).map((entry) => decodeValue(entry));
    default:
      return value;
  }
}

function decodeFields(fields = {}) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const [key, field] of Object.entries(fields)) {
    result[key] = decodeValue(field);
  }
  return result;
}

/** Ids de documentos do Firestore: sem `/`, 1..1500 bytes. */
function docId(raw, fallback) {
  const value = String(raw ?? fallback ?? '').trim();
  if (!value) return String(fallback);
  return value.replace(/[/\\]/g, '_').slice(0, 1400) || String(fallback);
}

/* ------------------------------------------------------------------ */

/**
 * Cria o backend do Firestore a partir do ambiente.
 * Se nenhuma credencial existir, retorna `{ enabled: false }` (modo local).
 * Se a configuração estiver incompleta, falha cedo com uma mensagem clara.
 */
export function createFirestoreBackend(env = process.env) {
  if (String(env.FIRESTORE_ENABLED || '').trim().toLowerCase() === 'false') {
    return { enabled: false };
  }

  let account;
  try {
    const read = readServiceAccount(env);
    if (!read) return { enabled: false };
    account = prepareServiceAccount(read);
  } catch (error) {
    throw new Error(`Firestore: não foi possível ler a conta de serviço. ${error.message}`);
  }

  const project = String(env.FIRESTORE_PROJECT || account.project_id || '');
  if (!project) {
    throw new Error('Firestore: informe FIRESTORE_PROJECT (o project_id do Google Cloud).');
  }

  const collections = String(env.FIRESTORE_COLLECTIONS || '')
    .split(',')
    .map((name) => name.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  const activeCollections = collections.length ? collections : DEFAULT_COLLECTIONS;
  const root = String(env.FIRESTORE_COLLECTION || DEFAULT_COLLECTION).replace(/^\/+|\/+$/g, '');

  const baseUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const rootPath = `${baseUrl}/${root}`;
  const commitUrl = baseUrl + ':commit';

  /** Caminho completo de um documento: meta ou de uma coleção de itens. */
  function docPath(collection, id) {
    if (collection === 'db') return `${rootPath}/meta`;
    return `${baseUrl}/${root}_${collection}/${id}`;
  }

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
      throw new Error(`Firestore: falha ao contatar o Google OAuth (${error.message}).`);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(
        `Firestore: o Google recusou a conta de serviço (${response.status}). ${detail}`.trim(),
      );
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error('Firestore: o Google não devolveu um access token.');
    }

    const ttl = Math.max(60, Number(data.expires_in) || 3600) * 1000;
    cachedToken = {
      value: data.access_token,
      // Renova um pouco antes de expirar.
      expiresAt: Date.now() + ttl - 60_000,
    };
    return cachedToken.value;
  }

  async function request(url, body) {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetchWithTimeout(url, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new Error(`Firestore: falha de rede no Firestore (${error.message}).`);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Firestore: o Firestore devolveu ${response.status}. ${detail}`.trim());
    }

    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  /** @type {Set<string>|null} Caminho completo dos documentos conhecidos. */
  let knownDocs = null;

  async function listCollection(collection, pages = 100) {
    // 'db' resolve o documento de meta; as demais são coleções prefixadas com a raiz.
    const urlBase = collection === 'db' ? rootPath : `${baseUrl}/${root}_${collection}`;
    const docs = [];
    let url = `${urlBase}?pageSize=300`;
    for (let page = 0; page < pages && url; page += 1) {
      const response = await request(url);
      for (const document of response.documents || []) {
        docs.push({
          name: document.name,
          fields: decodeFields(document.fields || {}),
        });
      }
      url = response.nextPageToken
        ? `${urlBase}?pageSize=300&pageToken=${encodeURIComponent(response.nextPageToken)}`
        : null;
    }
    return docs;
  }

  return {
    enabled: true,
    project,
    root,
    collections: activeCollections,
    baseUrl: rootPath,
    commitUrl,

    /**
     * Lê o banco completo do Firestore e o remonta em memória.
     * Retorna `null` quando o documento de meta ainda não existe.
     */
    async load() {
      const metaDocs = await listCollection('db');
      const meta = metaDocs.find((doc) => doc.name.endsWith('/meta'));
      if (!meta) return null;

      const db = {
        ...meta.fields,
      };

      for (const collection of activeCollections) {
        const items = await listCollection(collection);
        items.sort((a, b) => (Number(a.fields._i) || 0) - (Number(b.fields._i) || 0));
        db[collection] = items.map((item) => {
          const { _i, ...values } = item.fields;
          return values;
        });
      }
      return db;
    },

    /**
     * Grava o banco inteiro no Firestore.
     * Escreve os documentos novos/alterados e apaga os que saíram do banco,
     * em lotes de até 400 operações (limite do Firestore é 500).
     */
    async save(database) {
      /** Desired: [ { doc, fields } ] */
      const writes = [];

      const meta = {
        version: Number(database.version) || 0,
        createdAt: String(database.createdAt || ''),
        settings: database.settings || {},
        counters: database.counters || {},
      };
      writes.push({ doc: `${root}/meta`, fields: meta });

      let sequence = 0;
      for (const collection of activeCollections) {
        for (const item of database[collection] || []) {
          const id = docId(item?.id, sequence);
          writes.push({
            doc: `${root}_${collection}/${id}`,
            fields: { ...item, _i: sequence },
          });
          sequence += 1;
        }
      }

      // Documentos que deixaram de existir precisam ser apagados.
      if (!knownDocs) {
        knownDocs = new Set();
        for (const collection of ['db', ...activeCollections]) {
          try {
            for (const item of await listCollection(collection)) {
              // Do caminho completo para o sufixo (ex.: `rasec/meta`).
              knownDocs.add(item.name.replace(`${baseUrl}/`, ''));
            }
          } catch {
            /* primeira gravação pode não ter nada listável */
          }
        }
      }

      const knownPrefixes = [`${root}/`, `${root}_`];

      const desiredNames = new Set(writes.map(({ doc }) => doc));

      const operations = [];
      for (const name of knownDocs) {
        if (typeof name !== 'string') continue;
        if (!knownPrefixes.some((prefix) => name.startsWith(prefix))) continue;
        if (desiredNames.has(name)) continue;
        operations.push({ delete: `projects/${project}/databases/(default)/documents/${name}` });
      }
      for (const { doc, fields } of writes) {
        operations.push({
          update: {
            name: `projects/${project}/databases/(default)/documents/${doc}`,
            fields: encodeFields(fields),
          },
        });
      }

      for (let index = 0; index < operations.length; index += COMMIT_BATCH_LIMIT) {
        const batch = operations.slice(index, index + COMMIT_BATCH_LIMIT);
        if (!batch.length) continue;
        try {
          await request(commitUrl, { writes: batch });
        } catch (error) {
          if (index > 0) console.error('[rasec] commit parcial do Firestore falhou:', error.message);
          throw error;
        } finally {
          for (const operation of batch) {
            const name = operation.delete || operation.update?.name;
            if (!name) continue;
            // Guarda o sufixo, que é a chave estável dos documentos.
            const suffix = name.replace(`projects/${project}/databases/(default)/documents/`, '');
            if (operation.delete) knownDocs.delete(suffix);
            else knownDocs.add(suffix);
          }
        }
      }

      return true;
    },

    /** Testa credencial e acesso sem alterar nada. */
    async ping() {
      await getAccessToken();
      await request(`${rootPath}?mask.fieldPaths=version`);
      return true;
    },
  };
}
