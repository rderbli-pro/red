import { clamp } from './util.js';

export const state = {
  user: null,
  settings: {
    shopName: 'Rasec - Espetinhos',
    fairName: 'Feira de Empreendedorismo • C.E.P.K',
  },
  products: [],
  cart: new Map(),
  route: 'cardapio',
  lastSync: null,
  ui: {
    ordersStatus: 'todos',
    ordersQuery: '',
    dashboardAlertDismissed: false,
  },
};

export function setProducts(products) {
  state.products = products;
  for (const [id, qty] of [...state.cart]) {
    const product = products.find((item) => item.id === id);
    if (!product) {
      state.cart.delete(id);
      continue;
    }
    const next = clamp(qty, 0, product.stock);
    if (next <= 0) state.cart.delete(id);
    else state.cart.set(id, next);
  }
}

export function productById(id) {
  return state.products.find((product) => product.id === id) || null;
}

export function cartLines() {
  const lines = [];
  for (const [id, qty] of state.cart) {
    const product = productById(id);
    if (!product || qty <= 0) continue;
    lines.push({ product, qty, subtotal: product.price * qty });
  }
  return lines;
}

export function cartCount() {
  let total = 0;
  for (const qty of state.cart.values()) total += qty;
  return total;
}

export function cartTotal() {
  return cartLines().reduce((sum, line) => sum + line.subtotal, 0);
}

export function cartQty(id) {
  return state.cart.get(id) || 0;
}

export function addToCart(id, delta = 1) {
  const product = productById(id);
  if (!product || !product.available || product.stock <= 0) return cartQty(id);
  const next = clamp(cartQty(id) + delta, 0, product.stock);
  if (next <= 0) state.cart.delete(id);
  else state.cart.set(id, next);
  return next;
}

export function setCartQty(id, qty) {
  const product = productById(id);
  if (!product) {
    state.cart.delete(id);
    return 0;
  }
  const next = clamp(Number(qty) || 0, 0, Math.min(product.stock, 50));
  if (next <= 0) state.cart.delete(id);
  else state.cart.set(id, next);
  return next;
}

export function clearCart() {
  state.cart.clear();
}

export function resetSession() {
  state.user = null;
  state.products = [];
  state.cart.clear();
  state.route = 'cardapio';
  state.ui.ordersStatus = 'todos';
  state.ui.ordersQuery = '';
}
