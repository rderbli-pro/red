import { api } from './api.js';
import { icon } from './icons.js';
import { cartCount, resetSession, setProducts, state } from './state.js';
import { escapeHtml, initials } from './util.js';
import { openModal, toast } from './ui.js';
import { renderLogin } from './views/auth.js';
import { renderCart } from './views/cart.js';
import { renderDashboard } from './views/dashboard.js';
import { renderMenu } from './views/menu.js';
import { renderOrders } from './views/orders.js';
import { renderProfile } from './views/profile.js';
import { renderStock } from './views/stock.js';
import { renderTeam } from './views/team.js';

const app = document.getElementById('app');
const ROUTES = {
  cardapio: { label: 'CARDÁPIO', short: 'Cardápio', iconName: 'home', render: renderMenu, title: 'Cardápio' },
  carrinho: { label: 'CARRINHO', short: 'Carrinho', iconName: 'cart', render: renderCart, title: 'Carrinho' },
  painel: { label: 'PAINEL', short: 'Painel', iconName: 'chart', render: renderDashboard, title: 'Painel' },
  pedidos: { label: 'PEDIDOS', short: 'Pedidos', iconName: 'receipt', render: renderOrders, title: 'Pedidos' },
  estoque: { label: 'ESTOQUE', short: 'Estoque', iconName: 'box', render: renderStock, title: 'Estoque' },
  equipe: { label: 'EQUIPE', short: 'Equipe', iconName: 'users', render: renderTeam, title: 'Equipe', adminOnly: true },
  perfil: { label: 'PERFIL', short: 'Perfil', iconName: 'users', render: renderProfile, title: 'Perfil' },
};
const TABBAR = ['cardapio', 'painel', 'pedidos', 'estoque', 'perfil'];

let pollTimer = null;
let handlingExpired = false;
let installPrompt = null;

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return raw || 'cardapio';
}

function updateActiveNav() {
  for (const link of document.querySelectorAll('[data-route-link]')) {
    const active = link.dataset.routeLink === state.route;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

export function updateCartBadge() {
  const count = cartCount();
  for (const badge of document.querySelectorAll('[data-cart-badge]')) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }
  for (const button of document.querySelectorAll('[data-cart-button]')) {
    button.setAttribute('aria-label', count ? `Carrinho com ${count} ${count === 1 ? 'item' : 'itens'}` : 'Carrinho vazio');
    button.classList.toggle('has-items', count > 0);
  }
}

async function refreshProducts() {
  const result = await api.get('/api/products');
  setProducts(result.products);
  state.lastSync = new Date();
  updateCartBadge();
  return result.products;
}

function navigate(route, { replace = false } = {}) {
  if (!state.user) return;
  let target = ROUTES[route] ? route : 'cardapio';
  if (ROUTES[target].adminOnly && state.user.role !== 'admin') {
    toast('Apenas administradores podem abrir essa área.', 'error');
    target = 'cardapio';
  }
  const hash = `#/${target}`;
  if (location.hash === hash) {
    state.route = target;
    renderRoute({ scroll: true });
    return;
  }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

function logout() {
  stopPolling();
  api.post('/api/auth/logout').catch(() => {});
  resetSession();
  history.replaceState(null, '', location.pathname);
  showLogin('Você saiu da conta.');
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!state.user || document.hidden) return;
    if (!['painel', 'pedidos', 'estoque'].includes(state.route)) return;
    if (document.querySelector('.modal-backdrop')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    renderRoute({ silent: true });
  }, 15000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

const ctx = {
  api,
  navigate,
  updateCartBadge,
  refreshProducts,
  logout,
  isCurrent: (route) => state.route === route,
  canInstall: () => Boolean(installPrompt),
  install: async () => {
    if (!installPrompt) return false;
    const prompt = installPrompt;
    installPrompt = null;
    try {
      prompt.prompt();
      const choice = await prompt.userChoice;
      return choice.outcome === 'accepted';
    } catch {
      return false;
    }
  },
};

function headerMarkup() {
  const nav = ['cardapio', 'painel', 'pedidos', 'estoque', ...(state.user.role === 'admin' ? ['equipe'] : []), 'perfil'];
  return `
    <header class="topbar">
      <div class="topbar__inner">
        <a class="brand" href="#/cardapio" aria-label="Rasec - Espetinhos, ir para o cardápio">
          <img class="brand__logo" src="/assets/logo-rasec.svg" alt="" width="44" height="44">
          <span class="brand__text"><strong>RASEC</strong><small>ESPETINHOS</small></span>
        </a>
        <nav class="nav" aria-label="Navegação principal">
          ${nav
            .map(
              (key) => `
                <a class="nav__link" href="#/${key}" data-route-link="${key}">
                  ${ROUTES[key].label}
                </a>
              `,
            )
            .join('')}
        </nav>
        <div class="topbar__actions">
          <a class="cart-button" href="#/carrinho" data-cart-button aria-label="Carrinho vazio">
            ${icon('cart', 21)}
            <span class="cart-button__badge" data-cart-badge hidden>0</span>
          </a>
          <a class="user-chip" href="#/perfil" title="Meu perfil">
            <span class="avatar ${state.user.role === 'admin' ? 'avatar--admin' : ''}">${initials(state.user.name)}</span>
            <span class="user-chip__text"><strong>${escapeHtml(state.user.name.split(' ')[0])}</strong><small>${state.user.role === 'admin' ? 'ADMIN' : 'VENDEDOR'}</small></span>
          </a>
        </div>
      </div>
    </header>
  `;
}

function tabbarMarkup() {
  return `
    <nav class="tabbar" aria-label="Navegação rápida">
      ${TABBAR.map(
        (key) => `
          <a class="tabbar__item" href="#/${key}" data-route-link="${key}">
            <span class="tabbar__icon">${icon(ROUTES[key].iconName, 21)}</span>
            <span class="tabbar__label">${ROUTES[key].short}</span>
          </a>
        `,
      ).join('')}
    </nav>
  `;
}

function renderShell() {
  app.innerHTML = `
    <div class="shell">
      ${headerMarkup()}
      <main class="view" id="view"></main>
      <footer class="footer">
        <div class="footer__inner">
          <span class="footer__brand"><img src="/assets/logo-rasec.svg" alt="" width="26" height="26"> <strong>RASEC</strong> ESPETINHOS</span>
          <span class="footer__meta">Feira de Empreendedorismo • C.E.P.K 2026</span>
          <span class="footer__meta">@rasec.espetinhos</span>
        </div>
      </footer>
      ${tabbarMarkup()}
    </div>
  `;
  updateActiveNav();
  updateCartBadge();
}

async function renderRoute({ silent = false, scroll = false } = {}) {
  if (!state.user) return;
  let route = ROUTES[state.route] ? state.route : 'cardapio';
  if (ROUTES[route].adminOnly && state.user.role !== 'admin') {
    route = 'cardapio';
    state.route = route;
    history.replaceState(null, '', '#/cardapio');
    toast('Apenas administradores podem abrir essa área.', 'error');
  }

  document.title = `${ROUTES[route].title} • Rasec - Espetinhos`;
  updateActiveNav();
  if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });

  const view = document.getElementById('view');
  if (!view) return;
  const viewCtx = { ...ctx, silent };
  try {
    await ROUTES[route].render(view, viewCtx);
  } catch (error) {
    console.error(error);
    if (!silent) {
      view.innerHTML = `
        <div class="panel error-panel">
          <div class="panel__bar">ERRO INESPERADO</div>
          <p>${escapeHtml(error.message || 'Não foi possível carregar esta tela.')}</p>
          <button class="btn" type="button" data-reload>TENTAR DE NOVO</button>
        </div>
      `;
      view.querySelector('[data-reload]')?.addEventListener('click', () => renderRoute());
    }
  }
}

function promptInitialPassword() {
  if (!state.user?.mustChangePassword) return;
  const key = `rasec:pwd:${state.user.id}`;
  if (sessionStorage.getItem(key) === '1') return;
  const modal = openModal({
    title: 'SEGURANÇA DA CONTA',
    body: `
      <div class="confirm">
        <span class="confirm__icon confirm__icon--info">${icon('key', 26)}</span>
        <p><strong>${escapeHtml(state.user.name)}</strong>, sua conta ainda usa a senha inicial <code>rasec123</code>. Troque agora para ninguém entrar no seu lugar.</p>
      </div>
    `,
    dismissible: false,
    actions: [
      {
        label: 'DEPOIS',
        kind: 'ghost',
        onClick: () => {
          sessionStorage.setItem(key, '1');
        },
      },
      {
        label: 'TROCAR AGORA',
        kind: 'primary',
        autofocus: true,
        onClick: (close) => {
          close();
          navigate('perfil');
          setTimeout(() => {
            document.querySelector('.password-form input[name="currentPassword"]')?.focus();
          }, 200);
        },
      },
    ],
  });
  return modal;
}

function enterApp({ welcome = false } = {}) {
  handlingExpired = false;
  const initial = parseHash();
  state.route = ROUTES[initial] ? initial : 'cardapio';
  if (ROUTES[state.route].adminOnly && state.user.role !== 'admin') state.route = 'cardapio';
  history.replaceState(null, '', `#/${state.route}`);
  renderShell();
  renderRoute();
  startPolling();
  if (welcome) updateCartBadge();
  setTimeout(promptInitialPassword, 700);
}

function showLogin(notice = '') {
  stopPolling();
  app.innerHTML = '';
  renderLogin(app, {
    api,
    notice,
    onSuccess: async (user) => {
      state.user = user;
      try {
        const me = await api.get('/api/auth/me');
        state.settings = me.settings || state.settings;
        if (me.user) state.user = me.user;
      } catch {
        /* segue com os dados do login */
      }
      enterApp({ welcome: true });
    },
  });
}

function showOffline(message) {
  app.innerHTML = `
    <div class="offline">
      <div class="panel offline__panel">
        <div class="panel__bar">SEM CONEXÃO</div>
        <div class="offline__body">
          <img src="/assets/logo-rasec.svg" alt="" width="96" height="96">
          <h1>NÃO FOI POSSÍVEL FALAR COM O SERVIDOR</h1>
          <p>${escapeHtml(message || 'Confira se o servidor da barraca ainda está rodando e tente novamente.')}</p>
          <button class="btn btn--primary" type="button" data-retry>${icon('refresh', 15)} TENTAR DE NOVO</button>
        </div>
      </div>
    </div>
  `;
  app.querySelector('[data-retry]').addEventListener('click', () => boot());
}

async function boot() {
  try {
    const result = await api.get('/api/auth/me');
    state.user = result.user;
    state.settings = result.settings || state.settings;
    enterApp();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
    } else {
      showOffline(error.message);
    }
  }
}

window.addEventListener('hashchange', () => {
  if (!state.user) {
    showLogin();
    return;
  }
  const route = parseHash();
  if (!ROUTES[route]) {
    navigate('cardapio', { replace: true });
    renderRoute();
    return;
  }
  if (ROUTES[route].adminOnly && state.user.role !== 'admin') {
    toast('Apenas administradores podem abrir essa área.', 'error');
    navigate('cardapio', { replace: true });
    state.route = 'cardapio';
    renderRoute({ scroll: true });
    return;
  }
  state.route = route;
  renderRoute({ scroll: true });
});

window.addEventListener('rasec:unauthorized', () => {
  if (!state.user || handlingExpired) return;
  handlingExpired = true;
  resetSession();
  showLogin('Sua sessão expirou. Entre novamente.');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.user) return;
  if (['painel', 'pedidos', 'estoque'].includes(state.route) && !document.querySelector('.modal-backdrop')) {
    renderRoute({ silent: true });
  }
});

window.addEventListener('online', () => toast('Conexão restabelecida.', 'ok'));
window.addEventListener('offline', () => toast('Sem conexão com a rede.', 'error'));

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('App instalado! Abra a Rasec pela tela inicial.', 'ok');
});

// O service worker só é registrado em HTTPS ou localhost (exigência dos navegadores).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((error) => {
      console.warn('[rasec] PWA indisponível:', error.message);
    });
  });
}

boot();
