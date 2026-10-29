import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';
import { nowIso } from './util.js';

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || 'rasec123';
const DB_VERSION = 1;

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
    id: 'linguica',
    name: 'Espetinho de Linguiça',
    shortName: 'Linguiça',
    description: 'Linguiça artesanal na brasa, com aquele toque defumado que todo mundo ama.',
    price: 700,
    stock: 60,
    available: true,
    image: '/assets/espeto-linguica.svg',
    accent: '#b23c2b',
    order: 3,
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
  db.version ??= DB_VERSION;
  db.createdAt ??= nowIso();
  db.users ??= [];
  db.orders ??= [];
  db.sessions ??= [];
  db.settings ??= { ...seeded.settings };
  db.settings.inviteCode ??= 'RASEC2026';
  db.settings.shopName ??= 'Rasec - Espetinhos';
  db.settings.fairName ??= 'Feira de Empreendedorismo • C.E.P.K';
  db.counters ??= { nextOrderNumber: 1 };

  // Garante os três sabores caso o arquivo tenha sido criado incompleto.
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

export function createStore({ dataDir } = {}) {
  const directory = path.resolve(dataDir || process.env.DATA_DIR || 'data');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'db.json');
  const backupFile = path.join(directory, 'db.backup.json');

  let seeded = false;
  /** @type {any} */
  let db;
  if (fs.existsSync(file)) {
    try {
      db = migrate(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      throw new Error(
        `Não foi possível ler ${file}. O arquivo pode estar corrompido. ` +
          `Faça backup e remova-o para começar do zero. Detalhe: ${error.message}`,
      );
    }
  } else {
    db = seedDatabase();
    seeded = true;
  }

  let lastSavedAt = null;

  function persist() {
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

  function save() {
    persist();
  }

  function snapshot() {
    return {
      ...db,
      sessions: db.sessions.map((session) => ({ ...session, tokenHash: '[omitido]' })),
    };
  }

  // Sessões expiradas não precisam mais ocupar o arquivo.
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => new Date(session.expiresAt).getTime() > Date.now());
  if (db.sessions.length !== before) persist();

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
    snapshot,
    seeded,
    defaultPassword: DEFAULT_PASSWORD,
    dataDir: directory,
    get lastSavedAt() {
      return lastSavedAt;
    },
  };
}
