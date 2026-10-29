import { randomUUID } from 'node:crypto';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from './auth.js';
import {
  HttpError,
  centsToBRL,
  clearCookie,
  clientIp,
  csvCell,
  isSameLocalDay,
  localDateKey,
  nowIso,
  parseCookies,
  readJson,
  sendJson,
  setCookie,
  toInt,
  validatePassword,
  validateText,
  validateUsername,
} from './util.js';

const COOKIE = 'rasec_sessao';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ORDER_STATUS = ['pendente', 'preparando', 'entregue', 'cancelado'];
const PAYMENTS = ['pix', 'dinheiro'];
const PAYMENT_LABEL = { pix: 'Pix', dinheiro: 'Dinheiro' };
const STATUS_LABEL = {
  pendente: 'Pendente',
  preparando: 'Preparando',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

const DUMMY_HASH = hashPassword('rasec-senha-invalida');

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function orderItemsSummary(order) {
  return order.items.map((item) => `${item.qty}x ${item.name}`).join(' | ');
}

function money(cents) {
  return `R$ ${centsToBRL(cents)}`;
}

export function createApi(store) {
  const { db } = store;

  /** @type {Map<string, {count: number, firstAt: number}>} */
  const loginFailures = new Map();
  const LOGIN_WINDOW = 5 * 60 * 1000;
  const LOGIN_MAX = 8;

  function limitKey(req, username) {
    return `${clientIp(req)}|${String(username || '').toLowerCase()}`;
  }

  function assertLoginAllowed(key) {
    const entry = loginFailures.get(key);
    if (!entry) return;
    if (Date.now() - entry.firstAt > LOGIN_WINDOW) {
      loginFailures.delete(key);
      return;
    }
    if (entry.count >= LOGIN_MAX) {
      const wait = Math.max(1, Math.ceil((entry.firstAt + LOGIN_WINDOW - Date.now()) / 1000));
      throw new HttpError(429, `Muitas tentativas. Aguarde ${wait}s e tente de novo.`, 'rate_limited');
    }
  }

  function recordLoginFailure(key) {
    const entry = loginFailures.get(key);
    if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW) {
      loginFailures.set(key, { count: 1, firstAt: Date.now() });
    } else {
      entry.count += 1;
    }
    if (loginFailures.size > 2000) loginFailures.clear();
  }

  function currentAuth(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = db.sessions.find((item) => item.tokenHash === tokenHash);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      db.sessions = db.sessions.filter((item) => item.id !== session.id);
      store.save();
      return null;
    }
    const user = db.users.find((item) => item.id === session.userId);
    if (!user) return null;
    return { user, session, token };
  }

  function requireAuth(req) {
    const auth = currentAuth(req);
    if (!auth) throw new HttpError(401, 'Faça login para continuar.', 'unauthorized');
    return auth;
  }

  function requireAdmin(req) {
    const auth = requireAuth(req);
    if (auth.user.role !== 'admin') {
      throw new HttpError(403, 'Apenas administradores podem fazer isso.', 'forbidden');
    }
    return auth;
  }

  function startSession(req, res, user) {
    // Limita sessões antigas do mesmo usuário (cada aparelho tem a sua).
    const token = newSessionToken();
    const now = Date.now();
    const sessions = db.sessions.filter(
      (session) => new Date(session.expiresAt).getTime() > now,
    );
    sessions.push({
      id: randomUUID(),
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
    });
    const mine = sessions.filter((session) => session.userId === user.id);
    if (mine.length > 12) {
      const keep = new Set(mine.slice(-12).map((session) => session.id));
      db.sessions = sessions.filter((session) => session.userId !== user.id || keep.has(session.id));
    } else {
      db.sessions = sessions;
    }
    setCookie(res, COOKIE, token, {
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure: process.env.COOKIE_SECURE === '1' || Boolean(req.socket.encrypted),
    });
  }

  function hideUser(user) {
    return publicUser(user);
  }

  function findUserByUsername(username) {
    const normalized = String(username || '').trim().toLowerCase();
    return db.users.find((user) => user.username === normalized);
  }

  function productsWithSales() {
    const soldToday = new Map();
    const soldTotal = new Map();
    for (const order of db.orders) {
      if (order.status === 'cancelado') continue;
      const today = isSameLocalDay(order.createdAt);
      for (const item of order.items) {
        soldTotal.set(item.productId, (soldTotal.get(item.productId) || 0) + item.qty);
        if (today) soldToday.set(item.productId, (soldToday.get(item.productId) || 0) + item.qty);
      }
    }
    return db.products.map((product) => ({
      ...product,
      soldToday: soldToday.get(product.id) || 0,
      soldTotal: soldTotal.get(product.id) || 0,
      isSoldOut: !product.available || product.stock <= 0,
    }));
  }

  function orderWithMeta(order) {
    return { ...order };
  }

  function makeOrderNumber(number) {
    return String(number).padStart(3, '0');
  }

  function buildStats() {
    const now = new Date();
    const activeOrders = db.orders.filter((order) => order.status !== 'cancelado');
    const todayOrders = activeOrders.filter((order) => isSameLocalDay(order.createdAt, now));
    const cancelledToday = db.orders.filter(
      (order) => order.status === 'cancelado' && isSameLocalDay(order.createdAt, now),
    );

    let revenue = 0;
    let itemsSold = 0;
    for (const order of todayOrders) {
      revenue += order.total;
      for (const item of order.items) itemsSold += item.qty;
    }

    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue: 0 }));
    const byFlavor = new Map(
      db.products.map((product) => [
        product.id,
        { id: product.id, name: product.shortName || product.name, qty: 0, revenue: 0, stock: product.stock },
      ]),
    );
    const byPayment = new Map([
      ['pix', { payment: 'pix', label: PAYMENT_LABEL.pix, orders: 0, revenue: 0 }],
      ['dinheiro', { payment: 'dinheiro', label: PAYMENT_LABEL.dinheiro, orders: 0, revenue: 0 }],
    ]);
    const bySeller = new Map();

    for (const order of todayOrders) {
      const hour = new Date(order.createdAt).getHours();
      if (hour >= 0 && hour < 24) {
        byHour[hour].orders += 1;
        byHour[hour].revenue += order.total;
      }
      const payment = byPayment.get(order.payment);
      if (payment) {
        payment.orders += 1;
        payment.revenue += order.total;
      }
      const sellerId = order.createdBy?.id || 'desconhecido';
      const seller = bySeller.get(sellerId) || {
        id: sellerId,
        name: order.createdBy?.name || 'Equipe',
        orders: 0,
        revenue: 0,
        items: 0,
      };
      seller.orders += 1;
      seller.revenue += order.total;
      seller.items += order.items.reduce((sum, item) => sum + item.qty, 0);
      bySeller.set(sellerId, seller);
      for (const item of order.items) {
        const flavor = byFlavor.get(item.productId);
        if (flavor) {
          flavor.qty += item.qty;
          flavor.revenue += item.qty * item.price;
        }
      }
    }

    const allTimeRevenue = activeOrders.reduce((sum, order) => sum + order.total, 0);
    const pending = db.orders.filter((order) => order.status === 'pendente').length;
    const preparing = db.orders.filter((order) => order.status === 'preparando').length;
    const lowStock = db.products
      .filter((product) => product.stock <= 10)
      .map((product) => ({ id: product.id, name: product.shortName || product.name, stock: product.stock }));
    const defaultPasswords = db.users.filter((user) => user.mustChangePassword).length;

    return {
      today: {
        revenue,
        orders: todayOrders.length,
        items: itemsSold,
        ticket: todayOrders.length ? Math.round(revenue / todayOrders.length) : 0,
        cancelled: cancelledToday.length,
        pending,
        preparing,
      },
      allTime: { revenue: allTimeRevenue, orders: activeOrders.length },
      byHour,
      byFlavor: [...byFlavor.values()],
      byPayment: [...byPayment.values()],
      bySeller: [...bySeller.values()].sort((a, b) => b.revenue - a.revenue),
      lowStock,
      alerts: {
        defaultPasswords,
        lowStock: lowStock.length,
        pendingOrders: pending,
      },
      recentOrders: db.orders
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 8)
        .map(orderWithMeta),
      date: localDateKey(now),
      serverTime: now.toISOString(),
    };
  }

  function sendCsv(res, filename, rows) {
    const body = `\uFEFF${rows.join('\r\n')}\r\n`;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  async function handleAuth(req, res, method, segments, url) {
    // /api/auth/:action
    const action = segments[2];

    if (method === 'POST' && action === 'login') {
      const body = await readJson(req);
      const username = validateUsername(body.username);
      const password = String(body.password ?? '');
      if (!password) {
        throw new HttpError(400, 'Informe a senha.', 'validation_error', { password: 'Informe a senha.' });
      }
      const key = limitKey(req, username);
      assertLoginAllowed(key);
      const user = findUserByUsername(username);
      const ok = verifyPassword(
        password,
        user?.salt || DUMMY_HASH.salt,
        user?.passwordHash || DUMMY_HASH.hash,
      );
      if (!user || !ok) {
        recordLoginFailure(key);
        throw new HttpError(401, 'Usuário ou senha incorretos.', 'invalid_credentials');
      }
      loginFailures.delete(key);
      user.lastLoginAt = nowIso();
      startSession(req, res, user);
      store.save();
      return sendJson(res, 200, { user: hideUser(user) });
    }

    if (method === 'POST' && action === 'register') {
      const body = await readJson(req);
      const invite = String(body.inviteCode || '').trim().toUpperCase();
      const expected = String(db.settings.inviteCode || '').toUpperCase();
      if (expected && invite !== expected) {
        throw new HttpError(403, 'Código da equipe inválido. Confira com um administrador.', 'invalid_invite', {
          inviteCode: 'Código incorreto.',
        });
      }
      const name = validateText(body.name, { field: 'name', label: 'Nome', min: 2, max: 40 });
      const username = validateUsername(body.username);
      if (findUserByUsername(username)) {
        throw new HttpError(409, 'Esse usuário já existe. Escolha outro.', 'username_taken', {
          username: 'Usuário já cadastrado.',
        });
      }
      const password = validatePassword(body.password);
      const { salt, hash } = hashPassword(password);
      const user = {
        id: randomUUID(),
        username,
        name,
        role: 'vendedor',
        salt,
        passwordHash: hash,
        mustChangePassword: false,
        createdAt: nowIso(),
        lastLoginAt: nowIso(),
      };
      db.users.push(user);
      startSession(req, res, user);
      store.save();
      return sendJson(res, 201, { user: hideUser(user) });
    }

    if (method === 'POST' && action === 'logout') {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) {
        const tokenHash = hashToken(token);
        const before = db.sessions.length;
        db.sessions = db.sessions.filter((session) => session.tokenHash !== tokenHash);
        if (db.sessions.length !== before) store.save();
      }
      clearCookie(res, COOKIE);
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'GET' && action === 'me') {
      const { user } = requireAuth(req);
      return sendJson(res, 200, {
        user: hideUser(user),
        settings: {
          shopName: db.settings.shopName,
          fairName: db.settings.fairName,
        },
        serverTime: nowIso(),
      });
    }

    if (method === 'POST' && action === 'password') {
      const { user, session } = requireAuth(req);
      const body = await readJson(req);
      const current = String(body.currentPassword ?? '');
      if (!verifyPassword(current, user.salt, user.passwordHash)) {
        throw new HttpError(400, 'A senha atual está incorreta.', 'invalid_password', {
          currentPassword: 'Senha atual incorreta.',
        });
      }
      const next = validatePassword(body.newPassword, 'newPassword');
      if (current === next) {
        throw new HttpError(400, 'A nova senha precisa ser diferente da atual.', 'validation_error', {
          newPassword: 'Escolha uma senha diferente.',
        });
      }
      const { salt, hash } = hashPassword(next);
      user.salt = salt;
      user.passwordHash = hash;
      user.mustChangePassword = false;
      // Encerra as outras sessões por segurança.
      db.sessions = db.sessions.filter(
        (item) => item.userId !== user.id || item.id === session.id,
      );
      store.save();
      return sendJson(res, 200, { ok: true, user: hideUser(user) });
    }

    throw new HttpError(404, 'Rota de autenticação não encontrada.', 'not_found');
  }

  function handleProducts(req, res, method, segments) {
    if (method === 'GET' && segments.length === 2) {
      requireAuth(req);
      return sendJson(res, 200, { products: productsWithSales(), serverTime: nowIso() });
    }

    if (method === 'PATCH' && segments.length === 3) {
      requireAdmin(req);
      const product = db.products.find((item) => item.id === segments[2]);
      if (!product) throw new HttpError(404, 'Sabor não encontrado.', 'not_found');
      return readJson(req).then((body) => {
        if (body.price !== undefined) {
          product.price = toInt(body.price, { min: 0, max: 100000, field: 'price', label: 'Preço' });
        }
        if (body.stock !== undefined) {
          product.stock = toInt(body.stock, { min: 0, max: 100000, field: 'stock', label: 'Estoque' });
        }
        if (body.available !== undefined) {
          product.available = Boolean(body.available);
        }
        store.save();
        const updated = productsWithSales().find((item) => item.id === product.id);
        return sendJson(res, 200, { product: updated });
      });
    }

    throw new HttpError(404, 'Rota de produtos não encontrada.', 'not_found');
  }

  async function handleOrders(req, res, method, segments, url) {
    // /api/orders/export.csv
    if (method === 'GET' && segments[2] === 'export.csv') {
      requireAdmin(req);
      const rows = [
        [
          'Numero',
          'Data',
          'Hora',
          'Cliente',
          'Vendedor',
          'Itens',
          'Total (R$)',
          'Pagamento',
          'Recebido (R$)',
          'Troco (R$)',
          'Status',
        ].join(';'),
      ];
      const sorted = db.orders.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      for (const order of sorted) {
        const date = new Date(order.createdAt);
        rows.push(
          [
            makeOrderNumber(order.number),
            date.toLocaleDateString('pt-BR'),
            date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            csvCell(order.customer),
            csvCell(order.createdBy?.name || ''),
            csvCell(orderItemsSummary(order)),
            centsToBRL(order.total),
            PAYMENT_LABEL[order.payment] || order.payment,
            order.cashGiven == null ? '' : centsToBRL(order.cashGiven),
            order.change == null ? '' : centsToBRL(order.change),
            STATUS_LABEL[order.status] || order.status,
          ].join(';'),
        );
      }
      return sendCsv(res, `vendas-rasec-${localDateKey()}.csv`, rows);
    }

    if (method === 'GET' && segments.length === 2) {
      requireAuth(req);
      const statusParam = String(url.searchParams.get('status') || '').trim();
      const wanted = statusParam
        ? statusParam
            .split(',')
            .map((value) => value.trim())
            .filter((value) => ORDER_STATUS.includes(value))
        : [];
      const mine = url.searchParams.get('mine') === '1';
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));

      const auth = currentAuth(req);
      const base = db.orders.filter((order) => {
        if (mine && order.createdBy?.id !== auth.user.id) return false;
        return true;
      });

      const counts = { todos: base.length, pendente: 0, preparando: 0, entregue: 0, cancelado: 0 };
      for (const order of base) {
        if (counts[order.status] !== undefined) counts[order.status] += 1;
      }

      let filtered = base;
      if (wanted.length) filtered = filtered.filter((order) => wanted.includes(order.status));
      if (q) {
        filtered = filtered.filter((order) => {
          const number = makeOrderNumber(order.number);
          return (
            number.includes(q.replace('#', '')) ||
            String(order.customer || '').toLowerCase().includes(q) ||
            String(order.createdBy?.name || '').toLowerCase().includes(q)
          );
        });
      }

      filtered = filtered
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);

      return sendJson(res, 200, {
        orders: filtered.map(orderWithMeta),
        counts,
        total: filtered.length,
      });
    }

    if (method === 'POST' && segments.length === 2) {
      const { user } = requireAuth(req);
      const body = await readJson(req);
      const payment = String(body.payment || '').toLowerCase();
      if (!PAYMENTS.includes(payment)) {
        throw new HttpError(400, 'Escolha a forma de pagamento: Pix ou dinheiro.', 'validation_error', {
          payment: 'Selecione Pix ou dinheiro.',
        });
      }

      if (!Array.isArray(body.items) || body.items.length === 0) {
        throw new HttpError(400, 'Adicione pelo menos um espetinho ao pedido.', 'empty_cart');
      }
      if (body.items.length > 30) {
        throw new HttpError(400, 'Pedido grande demais.', 'too_many_items');
      }

      /** @type {Map<string, number>} */
      const quantities = new Map();
      for (const raw of body.items) {
        const productId = String(raw?.productId || '');
        const qty = toInt(raw?.qty, { min: 1, max: 50, field: 'qty', label: 'Quantidade' });
        quantities.set(productId, (quantities.get(productId) || 0) + qty);
      }

      const lines = [];
      let total = 0;
      for (const [productId, qty] of quantities) {
        const product = db.products.find((item) => item.id === productId);
        if (!product) throw new HttpError(400, 'Um dos sabores não existe mais.', 'invalid_item');
        if (!product.available) {
          throw new HttpError(409, `${product.shortName || product.name} está indisponível no momento.`, 'unavailable');
        }
        if (product.stock < qty) {
          throw new HttpError(
            409,
            `Estoque insuficiente de ${product.shortName || product.name}. Restam ${product.stock}.`,
            'insufficient_stock',
            { [`stock_${product.id}`]: `Restam ${product.stock}.` },
          );
        }
        lines.push({
          productId: product.id,
          name: product.shortName || product.name,
          fullName: product.name,
          price: product.price,
          qty,
          subtotal: product.price * qty,
        });
        total += product.price * qty;
      }

      if (body.expectedTotal !== undefined && body.expectedTotal !== null) {
        const expected = Number(body.expectedTotal);
        if (!Number.isFinite(expected) || expected !== total) {
          throw new HttpError(
            409,
            `Os preços foram atualizados. O novo total é ${money(total)}. Confira o pedido.`,
            'price_changed',
          );
        }
      }

      let cashGiven = null;
      let change = null;
      if (payment === 'dinheiro') {
        cashGiven = toInt(body.cashGiven, {
          min: 0,
          max: 10_000_000,
          field: 'cashGiven',
          label: 'Valor recebido',
        });
        if (cashGiven < total) {
          throw new HttpError(
            400,
            `O valor recebido é menor que o total. Faltam ${money(total - cashGiven)}.`,
            'insufficient_cash',
            { cashGiven: 'Valor menor que o total.' },
          );
        }
        change = cashGiven - total;
      }

      const customer = validateText(body.customer, {
        field: 'customer',
        label: 'Nome do cliente',
        min: 1,
        max: 60,
        required: false,
      }) || 'Cliente';

      const createdAt = nowIso();
      const order = {
        id: randomUUID(),
        number: db.counters.nextOrderNumber,
        customer,
        items: lines,
        total,
        payment,
        cashGiven,
        change,
        status: 'pendente',
        createdAt,
        updatedAt: createdAt,
        createdBy: { id: user.id, name: user.name, username: user.username },
        statusHistory: [{ status: 'pendente', at: createdAt, byName: user.name }],
      };
      db.counters.nextOrderNumber += 1;

      for (const line of lines) {
        const product = db.products.find((item) => item.id === line.productId);
        if (product) product.stock = Math.max(0, product.stock - line.qty);
      }

      db.orders.push(order);
      store.save();
      return sendJson(res, 201, { order: orderWithMeta(order) });
    }

    if (method === 'PATCH' && segments.length === 4 && segments[3] === 'status') {
      const { user } = requireAuth(req);
      const order = db.orders.find((item) => item.id === segments[2]);
      if (!order) throw new HttpError(404, 'Pedido não encontrado.', 'not_found');
      const body = await readJson(req);
      const status = String(body.status || '');
      if (!ORDER_STATUS.includes(status)) {
        throw new HttpError(400, 'Status inválido.', 'validation_error');
      }
      if (order.status === 'cancelado') {
        throw new HttpError(409, 'Pedido cancelado não pode ser alterado.', 'order_cancelled');
      }
      if (order.status === status) {
        return sendJson(res, 200, { order: orderWithMeta(order) });
      }
      if (status === 'cancelado') {
        for (const item of order.items) {
          const product = db.products.find((entry) => entry.id === item.productId);
          if (product) product.stock += item.qty;
        }
      }
      order.status = status;
      order.updatedAt = nowIso();
      order.statusHistory.push({ status, at: order.updatedAt, byName: user.name });
      store.save();
      return sendJson(res, 200, { order: orderWithMeta(order) });
    }

    throw new HttpError(404, 'Rota de pedidos não encontrada.', 'not_found');
  }

  async function handleUsers(req, res, method, segments) {
    if (method === 'GET' && segments.length === 2) {
      requireAdmin(req);
      const users = db.users
        .slice()
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
          return a.name.localeCompare(b.name, 'pt-BR');
        })
        .map(hideUser);
      return sendJson(res, 200, { users });
    }

    if (method === 'POST' && segments.length === 2) {
      requireAdmin(req);
      const body = await readJson(req);
      const name = validateText(body.name, { field: 'name', label: 'Nome', min: 2, max: 40 });
      const username = validateUsername(body.username);
      if (findUserByUsername(username)) {
        throw new HttpError(409, 'Esse usuário já existe.', 'username_taken', {
          username: 'Usuário já cadastrado.',
        });
      }
      const password = validatePassword(body.password);
      const role = body.role === 'admin' ? 'admin' : 'vendedor';
      const { salt, hash } = hashPassword(password);
      const user = {
        id: randomUUID(),
        username,
        name,
        role,
        salt,
        passwordHash: hash,
        mustChangePassword: true,
        createdAt: nowIso(),
        lastLoginAt: null,
      };
      db.users.push(user);
      store.save();
      return sendJson(res, 201, { user: hideUser(user) });
    }

    if (method === 'PATCH' && segments.length === 3) {
      const { user: actor } = requireAdmin(req);
      const target = db.users.find((item) => item.id === segments[2]);
      if (!target) throw new HttpError(404, 'Membro não encontrado.', 'not_found');
      const body = await readJson(req);

      if (body.name !== undefined) {
        target.name = validateText(body.name, { field: 'name', label: 'Nome', min: 2, max: 40 });
      }

      if (body.role !== undefined) {
        const role = body.role === 'admin' ? 'admin' : 'vendedor';
        if (target.role === 'admin' && role !== 'admin') {
          if (target.id === actor.id) {
            throw new HttpError(400, 'Você não pode remover seu próprio acesso de administrador.', 'forbidden');
          }
          const admins = db.users.filter((item) => item.role === 'admin').length;
          if (admins <= 1) {
            throw new HttpError(400, 'O sistema precisa de pelo menos um administrador.', 'last_admin');
          }
        }
        target.role = role;
      }

      let tempPassword = null;
      if (body.password !== undefined) {
        tempPassword = validatePassword(body.password);
        const { salt, hash } = hashPassword(tempPassword);
        target.salt = salt;
        target.passwordHash = hash;
        target.mustChangePassword = true;
        db.sessions = db.sessions.filter((session) => session.userId !== target.id);
      }

      store.save();
      return sendJson(res, 200, {
        user: hideUser(target),
        ...(tempPassword ? { temporaryPassword: tempPassword } : {}),
      });
    }

    throw new HttpError(404, 'Rota de equipe não encontrada.', 'not_found');
  }

  async function handleSettings(req, res, method, segments) {
    if (method === 'GET' && segments.length === 2) {
      requireAdmin(req);
      return sendJson(res, 200, {
        settings: {
          inviteCode: db.settings.inviteCode,
          shopName: db.settings.shopName,
          fairName: db.settings.fairName,
        },
      });
    }

    if (method === 'PATCH' && segments.length === 2) {
      requireAdmin(req);
      const body = await readJson(req);
      if (body.inviteCode !== undefined) {
        const code = String(body.inviteCode || '').trim().toUpperCase();
        if (!/^[A-Z0-9-]{4,24}$/.test(code)) {
          throw new HttpError(400, 'Código inválido. Use 4 a 24 letras, números ou hífen.', 'validation_error', {
            inviteCode: 'Ex.: RASEC2026',
          });
        }
        db.settings.inviteCode = code;
      }
      store.save();
      return sendJson(res, 200, { settings: { inviteCode: db.settings.inviteCode } });
    }

    throw new HttpError(404, 'Rota de configurações não encontrada.', 'not_found');
  }

  function handleAdmin(req, res, method, segments) {
    if (method === 'GET' && segments[2] === 'backup') {
      requireAdmin(req);
      const payload = {
        generatedAt: nowIso(),
        app: 'Rasec - Espetinhos',
        database: store.snapshot(),
      };
      const body = JSON.stringify(payload, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="backup-rasec-${localDateKey()}.json"`,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    }

    if (method === 'POST' && segments[2] === 'reset-orders') {
      requireAdmin(req);
      return readJson(req).then((body) => {
        if (String(body.confirm || '') !== 'APAGAR') {
          throw new HttpError(400, 'Confirmação inválida. Digite APAGAR para zerar as vendas.', 'invalid_confirmation');
        }
        const removed = db.orders.length;
        db.orders = [];
        db.counters.nextOrderNumber = 1;
        store.save();
        return sendJson(res, 200, { ok: true, removed });
      });
    }

    throw new HttpError(404, 'Rota administrativa não encontrada.', 'not_found');
  }

  return async function api(req, res, url) {
    const method = req.method || 'GET';
    const pathName = url.pathname.replace(/\/+$/, '') || '/';
    const segments = pathName.split('/').filter(Boolean);
    if (segments[0] !== 'api') throw new HttpError(404, 'Rota não encontrada.', 'not_found');

    // Health check público (usado pelos testes e pelo monitoramento).
    if (method === 'GET' && segments[1] === 'health' && segments.length === 2) {
      return sendJson(res, 200, {
        ok: true,
        app: 'Rasec - Espetinhos',
        version: 1,
        time: nowIso(),
      });
    }

    if (segments[1] === 'auth') {
      return handleAuth(req, res, method, segments, url);
    }
    if (segments[1] === 'products') {
      return handleProducts(req, res, method, segments);
    }
    if (segments[1] === 'orders') {
      return handleOrders(req, res, method, segments, url);
    }
    if (segments[1] === 'stats' && method === 'GET' && segments.length === 2) {
      requireAuth(req);
      return sendJson(res, 200, { stats: buildStats() });
    }
    if (segments[1] === 'users') {
      return handleUsers(req, res, method, segments);
    }
    if (segments[1] === 'settings') {
      return handleSettings(req, res, method, segments);
    }
    if (segments[1] === 'admin') {
      return handleAdmin(req, res, method, segments);
    }

    throw new HttpError(404, 'Rota não encontrada.', 'not_found');
  };
}
