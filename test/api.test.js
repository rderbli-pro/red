import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/index.js';

let server;
let base;
let dataDir;
let adminCookie = '';
let vendorCookie = '';

async function start() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasec-test-'));
  const app = createApp({ dataDir });
  server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  return app;
}

async function stop() {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
}

async function call(route, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV e textos puros */
  }
  return { response, json, text };
}

function saveCookie(result) {
  const header = result.response.headers.get('set-cookie') || '';
  return header.split(';')[0];
}

test('API da Rasec - fluxo completo', async (t) => {
  const app = await start();
  t.after(stop);

  await t.test('health público', async () => {
    const { response, json } = await call('/api/health');
    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.app, 'Rasec - Espetinhos');
  });

  await t.test('PWA: manifest, service worker e ícones', async () => {
    const manifest = await call('/manifest.webmanifest');
    assert.equal(manifest.response.status, 200);
    assert.match(manifest.response.headers.get('content-type'), /application\/manifest\+json/);
    assert.equal(manifest.json.name, 'Rasec - Espetinhos');
    assert.ok(manifest.json.icons.some((icon) => icon.sizes === '192x192'));
    assert.ok(manifest.json.icons.some((icon) => icon.sizes === '512x512'));

    const sw = await call('/sw.js');
    assert.equal(sw.response.status, 200);
    assert.equal(sw.response.headers.get('cache-control'), 'no-cache');
    assert.match(sw.text, /rasec-v1/);

    const icon = await call('/assets/icons/icon-192.png');
    assert.equal(icon.response.status, 200);
    assert.match(icon.response.headers.get('content-type'), /image\/png/);

    const html = await call('/');
    assert.equal(html.response.status, 200);
    assert.match(html.text, /manifest\.webmanifest/);
    assert.match(html.text, /apple-touch-icon\.png/);
  });

  await t.test('seed cria 7 contas e 3 sabores', async () => {
    assert.equal(app.store.db.users.length, 7);
    assert.deepEqual(
      app.store.db.users.map((user) => user.username).sort(),
      ['bruna', 'bruno', 'eduardo', 'endrick', 'jhonathan', 'julia', 'kaua'],
    );
    assert.equal(app.store.db.products.length, 3);
    assert.equal(app.store.db.products.find((product) => product.id === 'carne').price, 900);
  });

  await t.test('login recusa senha errada', async () => {
    const { response, json } = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'bruno', password: 'errada' },
    });
    assert.equal(response.status, 401);
    assert.equal(json.code, 'invalid_credentials');
  });

  await t.test('login do administrador', async () => {
    const result = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'bruno', password: 'rasec123' },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.json.user.role, 'admin');
    adminCookie = saveCookie(result);
    assert.match(adminCookie, /^rasec_sessao=/);
  });

  await t.test('me devolve o usuário logado', async () => {
    const { response, json } = await call('/api/auth/me', { cookie: adminCookie });
    assert.equal(response.status, 200);
    assert.equal(json.user.username, 'bruno');
    assert.equal(json.user.passwordHash, undefined);
  });

  await t.test('produtos pedem autenticação', async () => {
    const { response } = await call('/api/products');
    assert.equal(response.status, 401);
    const { response: ok, json } = await call('/api/products', { cookie: adminCookie });
    assert.equal(ok.status, 200);
    assert.equal(json.products.length, 3);
    assert.equal(json.products.every((product) => product.stock === 60), true);
  });

  let firstOrderId = '';

  await t.test('venda no Pix calcula total e baixa estoque', async () => {
    const { response, json } = await call('/api/orders', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        customer: 'Ana',
        payment: 'pix',
        items: [
          { productId: 'carne', qty: 2 },
          { productId: 'frango', qty: 1 },
        ],
      },
    });
    assert.equal(response.status, 201);
    assert.equal(json.order.total, 2600);
    assert.equal(json.order.number, 1);
    assert.equal(json.order.change, null);
    assert.equal(json.order.items.length, 2);
    firstOrderId = json.order.id;

    const { json: products } = await call('/api/products', { cookie: adminCookie });
    assert.equal(products.products.find((p) => p.id === 'carne').stock, 58);
    assert.equal(products.products.find((p) => p.id === 'frango').stock, 59);
    assert.equal(products.products.find((p) => p.id === 'carne').soldToday, 2);
  });

  await t.test('estatísticas refletem a venda', async () => {
    const { response, json } = await call('/api/stats', { cookie: adminCookie });
    assert.equal(response.status, 200);
    assert.equal(json.stats.today.revenue, 2600);
    assert.equal(json.stats.today.orders, 1);
    assert.equal(json.stats.today.items, 3);
    assert.equal(json.stats.today.ticket, 2600);
    assert.equal(json.stats.byFlavor.find((f) => f.id === 'carne').qty, 2);
    assert.equal(json.stats.byPayment.find((p) => p.payment === 'pix').revenue, 2600);
  });

  await t.test('dinheiro exige valor suficiente', async () => {
    const { response, json } = await call('/api/orders', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        payment: 'dinheiro',
        cashGiven: 1000,
        items: [{ productId: 'linguica', qty: 2 }],
      },
    });
    assert.equal(response.status, 400);
    assert.equal(json.code, 'insufficient_cash');
  });

  await t.test('dinheiro calcula troco', async () => {
    const { response, json } = await call('/api/orders', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        customer: 'Beto',
        payment: 'dinheiro',
        cashGiven: 5000,
        items: [{ productId: 'linguica', qty: 2 }],
      },
    });
    assert.equal(response.status, 201);
    assert.equal(json.order.total, 1400);
    assert.equal(json.order.change, 3600);
    assert.equal(json.order.number, 2);
  });

  await t.test('preço alterado invalida total antigo', async () => {
    const { response } = await call('/api/products/carne', {
      method: 'PATCH',
      cookie: adminCookie,
      body: { price: 1000 },
    });
    assert.equal(response.status, 200);

    const stale = await call('/api/orders', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        payment: 'pix',
        expectedTotal: 2600,
        items: [
          { productId: 'carne', qty: 2 },
          { productId: 'frango', qty: 1 },
        ],
      },
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.json.code, 'price_changed');

    const fresh = await call('/api/orders', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        payment: 'pix',
        expectedTotal: 2800,
        items: [
          { productId: 'carne', qty: 2 },
          { productId: 'frango', qty: 1 },
        ],
      },
    });
    assert.equal(fresh.response.status, 201);
    assert.equal(fresh.json.order.total, 2800);
  });

  await t.test('cancelar pedido devolve o estoque', async () => {
    const { response } = await call(`/api/orders/${firstOrderId}/status`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { status: 'cancelado' },
    });
    assert.equal(response.status, 200);

    const { json: products } = await call('/api/products', { cookie: adminCookie });
    assert.equal(products.products.find((p) => p.id === 'carne').stock, 58);
    // 60 - 1 (pedido 1) - 1 (pedido 3) + 1 (estorno do pedido 1)
    assert.equal(products.products.find((p) => p.id === 'frango').stock, 59);

    const again = await call(`/api/orders/${firstOrderId}/status`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { status: 'entregue' },
    });
    assert.equal(again.response.status, 409);
  });

  await t.test('não vende mais que o estoque', async () => {
    const { response, json } = await call('/api/orders', {
      method: 'POST',
      cookie: adminCookie,
      body: { payment: 'pix', items: [{ productId: 'carne', qty: 500 }] },
    });
    assert.equal(response.status, 400);
    assert.equal(json.code, 'validation_error');
  });

  await t.test('cadastro exige código da equipe e cria vendedor', async () => {
    const wrong = await call('/api/auth/register', {
      method: 'POST',
      body: { name: 'Teste', username: 'teste', password: 'senha123', inviteCode: 'ERRADO' },
    });
    assert.equal(wrong.response.status, 403);

    const result = await call('/api/auth/register', {
      method: 'POST',
      body: { name: 'Teste', username: 'teste', password: 'senha123', inviteCode: 'RASEC2026' },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.json.user.role, 'vendedor');
    vendorCookie = saveCookie(result);
    assert.ok(vendorCookie.startsWith('rasec_sessao='));
  });

  await t.test('vendedor vende, mas não altera preço nem equipe', async () => {
    const sale = await call('/api/orders', {
      method: 'POST',
      cookie: vendorCookie,
      body: { payment: 'pix', items: [{ productId: 'frango', qty: 1 }] },
    });
    assert.equal(sale.response.status, 201);

    const patch = await call('/api/products/carne', {
      method: 'PATCH',
      cookie: vendorCookie,
      body: { price: 1 },
    });
    assert.equal(patch.response.status, 403);

    const users = await call('/api/users', { cookie: vendorCookie });
    assert.equal(users.response.status, 403);
  });

  await t.test('admin cria membro e redefine senha', async () => {
    const created = await call('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Novo Membro', username: 'novo', password: 'abc123', role: 'vendedor' },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.user.mustChangePassword, true);

    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'novo', password: 'abc123' },
    });
    assert.equal(login.response.status, 200);

    const reset = await call(`/api/users/${created.json.user.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { password: 'nova-senha' },
    });
    assert.equal(reset.response.status, 200);

    const oldLogin = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'novo', password: 'abc123' },
    });
    assert.equal(oldLogin.response.status, 401);
    const newLogin = await call('/api/auth/login', {
      method: 'POST',
      body: { username: 'novo', password: 'nova-senha' },
    });
    assert.equal(newLogin.response.status, 200);
  });

  await t.test('CSV de vendas é exportado', async () => {
    const { response, text } = await call('/api/orders/export.csv', { cookie: adminCookie });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/csv/);
    assert.match(text, /Numero;Data;Hora/);
    assert.match(text, /Rasec|Cliente|Pix/);
  });

  await t.test('lista de pedidos tem contadores', async () => {
    const { response, json } = await call('/api/orders', { cookie: adminCookie });
    assert.equal(response.status, 200);
    assert.equal(json.counts.todos, 4);
    assert.equal(json.counts.cancelado, 1);
    assert.ok(json.orders.length >= 3);
  });

  await t.test('logout invalida a sessão', async () => {
    const out = await call('/api/auth/logout', { method: 'POST', cookie: vendorCookie });
    assert.equal(out.response.status, 200);
    const me = await call('/api/auth/me', { cookie: vendorCookie });
    assert.equal(me.response.status, 401);
  });

  await t.test('backup e reset de vendas', async () => {
    const backup = await call('/api/admin/backup', { cookie: adminCookie });
    assert.equal(backup.response.status, 200);
    assert.equal(backup.json.database.orders.length, 4);

    const denied = await call('/api/admin/reset-orders', {
      method: 'POST',
      cookie: adminCookie,
      body: { confirm: 'sim' },
    });
    assert.equal(denied.response.status, 400);

    const reset = await call('/api/admin/reset-orders', {
      method: 'POST',
      cookie: adminCookie,
      body: { confirm: 'APAGAR' },
    });
    assert.equal(reset.response.status, 200);
    assert.equal(reset.json.removed, 4);

    const stats = await call('/api/stats', { cookie: adminCookie });
    assert.equal(stats.json.stats.today.revenue, 0);
    const orders = await call('/api/orders', { cookie: adminCookie });
    assert.equal(orders.json.counts.todos, 0);

    const newSale = await call('/api/orders', {
      method: 'POST',
      cookie: adminCookie,
      body: { payment: 'pix', items: [{ productId: 'linguica', qty: 1 }] },
    });
    assert.equal(newSale.json.order.number, 1);
  });
});
