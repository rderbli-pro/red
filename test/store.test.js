import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createFirebaseBackend } from '../server/firebase.js';
import { createStore } from '../server/store.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rasec-store-'));
}

function fakeFirebase(initial = null) {
  let data = initial;
  let saves = 0;
  let failures = 0;
  return {
    enabled: true,
    databaseUrl: 'https://fake.firebaseio.com',
    databasePath: 'rasec/db',
    async load() {
      return data ? structuredClone(data) : null;
    },
    async save(database) {
      if (failures > 0) {
        failures -= 1;
        throw new Error('Firebase indisponível');
      }
      saves += 1;
      data = structuredClone(database);
    },
    get data() {
      return data;
    },
    get saves() {
      return saves;
    },
    failNext(count = 1) {
      failures = count;
    },
  };
}

function cleanup(t, directory) {
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test('store local cria 4 sabores e não tem linguiça', async (t) => {
  const directory = tempDir();
  cleanup(t, directory);

  const store = await createStore({
    dataDir: directory,
    firebase: { enabled: false },
  });

  assert.equal(store.storageStatus().mode, 'local');
  assert.equal(store.db.version, 2);
  assert.equal(store.db.products.length, 4);
  assert.deepEqual(
    store.db.products.map((product) => product.id),
    ['carne', 'frango', 'coracao', 'misto'],
  );
  assert.equal(store.db.products.some((product) => product.id === 'linguica'), false);
  assert.equal(await store.save(), true);
});

test('migração transforma linguiça em coração preservando preço e estoque', async (t) => {
  const directory = tempDir();
  cleanup(t, directory);

  fs.writeFileSync(
    path.join(directory, 'db.json'),
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      users: [],
      orders: [],
      sessions: [],
      settings: {},
      counters: { nextOrderNumber: 1 },
      products: [
        {
          id: 'linguica',
          name: 'Espetinho de Linguiça',
          shortName: 'Linguiça',
          description: 'antiga',
          price: 700,
          stock: 7,
          available: false,
          image: '/assets/espeto-linguica.svg',
          accent: '#b23c2b',
          order: 3,
        },
      ],
    }),
    'utf8',
  );

  const store = await createStore({
    dataDir: directory,
    firebase: { enabled: false },
  });

  const heart = store.db.products.find((product) => product.id === 'coracao');
  assert.ok(heart);
  assert.equal(heart.price, 700);
  assert.equal(heart.stock, 7);
  assert.equal(heart.available, false);
  assert.equal(heart.name, 'Espetinho de Coração de Galinha');
  assert.equal(store.db.products.some((product) => product.id === 'linguica'), false);
  assert.equal(store.db.products.length, 4);
});

test('Firebase vazio recebe o seed e as alterações', async (t) => {
  const directory = tempDir();
  cleanup(t, directory);
  const firebase = fakeFirebase(null);

  const store = await createStore({ dataDir: directory, firebase });

  assert.equal(store.storageStatus().mode, 'firebase');
  assert.equal(firebase.data.users.length, 7);
  assert.equal(firebase.data.products.length, 4);
  assert.equal(firebase.data.products.find((product) => product.id === 'coracao').price, 800);

  store.db.products.find((product) => product.id === 'misto').stock = 12;
  assert.equal(await store.save(), true);
  assert.equal(firebase.data.products.find((product) => product.id === 'misto').stock, 12);
  assert.equal(firebase.data.products.find((product) => product.id === 'coracao').stock, 60);
  assert.equal(store.storageStatus().pending, false);
  assert.equal(store.storageStatus().ok, true);
});

test('Firebase existente é carregado em vez do seed local', async (t) => {
  const directory = tempDir();
  cleanup(t, directory);
  const firebase = fakeFirebase(null);

  const first = await createStore({ dataDir: directory, firebase });
  first.db.products.find((product) => product.id === 'carne').stock = 3;
  await first.save();

  const secondDirectory = tempDir();
  cleanup(t, secondDirectory);
  const second = await createStore({
    dataDir: secondDirectory,
    firebase,
  });

  assert.equal(second.seeded, false);
  assert.equal(second.db.products.find((product) => product.id === 'carne').stock, 3);
  assert.equal(second.db.products.length, 4);
});

test('store não inicia com Firebase configurado e inacessível', async (t) => {
  const directory = tempDir();
  cleanup(t, directory);
  const firebase = fakeFirebase(null);
  firebase.failNext(1);

  await assert.rejects(
    () => createStore({ dataDir: directory, firebase }),
    /Não foi possível gravar o banco no Firebase/,
  );
});

test('firebase exige URL e credencial juntas', () => {
  assert.equal(createFirebaseBackend({}).enabled, false);

  assert.throws(
    () =>
      createFirebaseBackend({
        FIREBASE_DATABASE_URL: 'https://rasec.firebaseio.com',
      }),
    /FIREBASE_SERVICE_ACCOUNT/,
  );

  assert.throws(
    () =>
      createFirebaseBackend({
        FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from('{}').toString('base64'),
      }),
    /FIREBASE_DATABASE_URL/,
  );
});

test('firebase normaliza URL, nó e credencial Base64', () => {
  const account = {
    client_email: 'rasec@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  };
  const backend = createFirebaseBackend({
    FIREBASE_DATABASE_URL: 'https://rasec.firebaseio.com///',
    FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify(account)).toString('base64'),
    FIREBASE_DB_PATH: '/meu/nó/',
  });

  assert.equal(backend.enabled, true);
  assert.equal(backend.databaseUrl, 'https://rasec.firebaseio.com');
  assert.equal(backend.databasePath, 'meu/nó');
  assert.equal(backend.endpoint, 'https://rasec.firebaseio.com/meu/nó.json');
});
