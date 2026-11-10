import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { createFirestoreBackend } from './firestore.js';
import { nowIso } from './util.js';

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || 'rasec123';
const DB_VERSION = 2;
const FIREBASE_RETRY_MS = 5_000;
const FIREBASE_RETRY_MAX_MS = 30_000;

export const TEAM = [
  { username: 'bruno', name: 'Bruno' },
  { username: 'bruna', name: 'Bruna' },
  { username: 'eduardo', name: 'Eduardo' },
  { username: 'julia', name: 'Júlia' },
  { username: 'endrick', name: 'Endrick' },
  { username: 'kaua', name: 'Kauá' },
  { username: 'jhonathan', name: 'Jhonathan' },
];

const PRODUCTS = [
  {
    id: 'carne',
    name: 'Espetinho de Carne',
    shortName: 'Carne',
    description: 'Carne bovina macia, temperada no alho e na pimenta, dourada na brasa.',
    price: 900,
    stock: 60,
    available: true,
    image: '/assets/espeto-carne.svg',
    accent: '#a64b2a',
    order: 1,
  },
  {
    id: 'frango',
    name: 'Espetinho de Frango',
    shortName: 'Frango',
    description: 'Frango marinado no limão e nas ervas, suculento e levemente defumado.',
    price: 800,
    stock: 60,
    available: true,
    image: '/assets/espeto-frango.svg',
    accent: '#cf9140',
    order: 2,
  },
  {
    id: 'coracao',
    name: 'Espetinho de Coração de Galinha',
    shortName: 'Coração',
    description: 'Coração de galinha temperado e dourado na brasa, macio por dentro e crocante por fora.',
    price: 800,
    stock: 60,
    available: true,
    image: '/assets/espeto-coracao.svg',
    accent: '#b23c3c',
    order: 3,
  },
  {
    id: 'misto',
    name: 'Espetinho Misto',
    shortName: 'Misto',
    description: 'Carne bovina com pimentão e cebola na brasa, colorido e cheio de sabor.',
    price: 1000,
    stock: 60,
    available: true,
    image: '/assets/espeto-misto.svg',
    accent: '#6f8f3a',
    order: 4,
  },
];

function seedDatabase() {
  const now = nowIso();
  return {
    version: DB_VERSION,
    createdAt: now,
    users: TEAM.map((member) => {
      const { salt, hash } = hashPassword(DEFAULT_PASSWORD);
      return {
        id: randomUUID(),
        username: member.username,
        name: member.name,
        role: 'admin',
        salt,
        passwordHash: hash,
        mustChangePassword: true,
        createdAt: now,
        lastLoginAt: null,
      };
    }),
    products: PRODUCTS.map((product) => ({ ...product })),
    orders: [],
    sessions: [],
    settings: {
      inviteCode: 'RASEC2026',
      shopName: 'Rasec - Espetinhos',
      fairName: 'Feira de Empreendedorismo • C.E.P.K',
      version: DB_VERSION,
    },
    counters: { nextOrderNumber: 1 },
  };
}

/** Completa campos que possam faltar em bancos antigos. */
function migrate(db) {
  const seeded = seedDatabase();
  db.version = DB_VERSION;
  db.createdAt ??= nowIso();
  db.users ??= [];
  if (!db.users.length) db.users = seeded.users;
  db.products ??= [];
  db.orders ??= [];
  db.sessions ??= [];
  db.settings ??= { ...seeded.settings };
  db.settings.inviteCode ??= 'RASEC2026';
  db.settings.shopName ??= 'Rasec - Espetinhos';
  db.settings.fairName ??= 'Feira de Empreendedorismo • C.E.P.K';
  db.settings.version = DB_VERSION;
  db.counters ??= { nextOrderNumber: 1 };

  // O sabor de linguiça saiu do cardápio. Quando o banco antigo tem esse item,
  // ele vira o coração de galinha (preservando preço/estoque configurados).
  const heart = PRODUCTS.find((product) => product.id === 'coracao');
  const legacy = db.products.find((product) => product.id === 'linguica');
  if (legacy) {
    const alreadyHasHeart = db.products.some((product) => product.id === 'coracao');
    if (alreadyHasHeart) {
      db.products = db.products.filter((product) => product.id !== 'linguica');
    } else {
      Object.assign(legacy, {
        id: heart.id,
        name: heart.name,
        shortName: heart.shortName,
        description: heart.description,
        image: heart.image,
        accent: heart.accent,
        order: heart.order,
      });
    }
  }

  // Garante todos os sabores caso o arquivo tenha sido criado incompleto.
  for (const product of PRODUCTS) {
    if (!db.products.some((item) => item.id === product.id)) {
      db.products.push({ ...product });
    }
  }
  db.products.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!Number.isInteger(db.counters.nextOrderNumber) || db.counters.nextOrderNumber < 1) {
    const highest = db.orders.reduce((max, order) => Math.max(max, Number(order.number) || 0), 0);
    db.counters.nextOrderNumber = highest + 1;
  }
  return db;
}

function readLocalDatabase(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `Não foi possível ler ${file}. O arquivo pode estar corrompido. ` +
        `Faça backup e remova-o para começar do zero. Detalhe: ${error.message}`,
    );
  }
}

/**
 * Cria o banco local (JSON) e, quando configurado, sincroniza com o Firestore.
 * A leitura do Firestore é assíncrona; por isso a criação da store também é.
 */
export async function createStore({ dataDir, firebase } = {}) {
  const directory = path.resolve(dataDir || process.env.DATA_DIR || 'data');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'db.json');
  const backupFile = path.join(directory, 'db.backup.json');

  const remote = firebase || createFirestoreBackend();

  let seeded = false;
  /** @type {any} */
  let db;

  if (remote.enabled) {
    let remoteDb;
    try {
      remoteDb = await remote.load();
    } catch (error) {
      throw new Error(
        `Não foi possível carregar o banco do Firestore. ` +
          `O app não vai iniciar com dados vazios por segurança. Detalhe: ${error.message}`,
      );
    }

    if (remoteDb) {
      if (typeof remoteDb !== 'object' || Array.isArray(remoteDb)) {
        throw new Error('O banco remoto do Firestore está em um formato inválido.');
      }
      db = migrate(remoteDb);
    } else if (fs.existsSync(file)) {
      // Primeira vez com Firestore: sobe o banco local que já existe.
      db = migrate(readLocalDatabase(file));
    } else {
      db = seedDatabase();
      seeded = true;
    }
  } else if (fs.existsSync(file)) {
    db = migrate(readLocalDatabase(file));
  } else {
    db = seedDatabase();
    seeded = true;
  }

  let lastSavedAt = null;

  function persistLocal() {
    const temp = `${file}.tmp`;
    const json = JSON.stringify(db, null, 2);
    try {
      fs.writeFileSync(temp, json, 'utf8');
      fs.renameSync(temp, file);
    } catch (error) {
      console.error('[rasec] falha ao gravar banco, tentando gravação direta:', error.message);
      fs.writeFileSync(file, json, 'utf8');
    }
    lastSavedAt = new Date();
  }

  let remoteDirty = false;
  let remoteActive = null;
  let remoteTimer = null;
  let remoteRetryMs = FIREBASE_RETRY_MS;
  let lastRemoteError = null;
  let lastRemoteSavedAt = null;

  function scheduleRemoteRetry() {
    if (!remote.enabled || remoteTimer) return;
    remoteTimer = setTimeout(() => {
      remoteTimer = null;
      if (remoteDirty) queueRemoteSave();
    }, remoteRetryMs);
    remoteTimer.unref?.();
    remoteRetryMs = Math.min(remoteRetryMs * 2, FIREBASE_RETRY_MAX_MS);
  }

  function queueRemoteSave() {
    if (!remote.enabled) return Promise.resolve(true);
    remoteDirty = true;
    if (!remoteActive) remoteActive = flushRemote();
    return remoteActive;
  }

  async function flushRemote() {
    try {
      while (remoteDirty) {
        remoteDirty = false;
        try {
          await remote.save(db);
          lastRemoteError = null;
          lastRemoteSavedAt = new Date();
          remoteRetryMs = FIREBASE_RETRY_MS;
        } catch (error) {
          remoteDirty = true;
          lastRemoteError = error;
          console.error('[rasec] falha ao gravar no Firestore:', error.message);
          scheduleRemoteRetry();
          break;
        }
      }
    } finally {
      remoteActive = null;
    }
    return !lastRemoteError;
  }

  function save() {
    persistLocal();
    return queueRemoteSave();
  }

  function flush() {
    if (!remote.enabled) return Promise.resolve(true);
    if (remoteActive) return remoteActive;
    if (!remoteDirty) return Promise.resolve(!lastRemoteError);
    return queueRemoteSave();
  }

  function snapshot() {
    return {
      ...db,
      sessions: db.sessions.map((session) => ({ ...session, tokenHash: '[omitido]' })),
    };
  }

  function storageStatus() {
    return {
      mode: remote.enabled ? 'firestore' : 'local',
      database: remote.enabled ? `${remote.root} (Firestore • ${remote.project})` : file,
      localFile: file,
      pending: remoteDirty,
      ok: !lastRemoteError,
      lastError: lastRemoteError ? lastRemoteError.message : null,
      lastRemoteSavedAt: lastRemoteSavedAt ? lastRemoteSavedAt.toISOString() : null,
    };
  }

  // Com o Firestore configurado, a primeira gravação remota precisa acontecer
  // antes de o servidor começar a atender. Sem isso, um deploy que subisse com
  // banco vazio poderia sobrescrever os dados bons.
  if (remote.enabled) {
    persistLocal();
    try {
      await remote.save(db);
      lastRemoteSavedAt = new Date();
      lastRemoteError = null;
    } catch (error) {
      throw new Error(
        `Não foi possível gravar o banco no Firestore durante a inicialização. ` +
          `Verifique a credencial, se o Native Firestore está ativado no projeto e as regras. Detalhe: ${error.message}`,
      );
    }
  }

  // Sessões expiradas não precisam mais ocupar o arquivo.
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now());
  if (db.sessions.length !== before) await save();

  if (seeded) {
    // Guarda uma cópia do estado inicial (sem sessões) para emergências.
    try {
      fs.writeFileSync(backupFile, JSON.stringify(snapshot(), null, 2), 'utf8');
    } catch {
      /* backup é opcional */
    }
  }

  return {
    db,
    file,
    backupFile,
    save,
    flush,
    snapshot,
    storageStatus,
    seeded,
    defaultPassword: DEFAULT_PASSWORD,
    dataDir: directory,
    get lastSavedAt() {
      return lastSavedAt;
    },
    get storageDescription() {
      return remote.enabled
        ? `Firestore (coleção "${remote.root}" • projeto ${remote.project}) + cache local`
        : file;
    },
  };
}
