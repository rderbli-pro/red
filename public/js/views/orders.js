import { api } from '../api.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { escapeHtml, money, orderNumber, PAYMENT_LABEL, plural, STATUS_LABEL, timeOfDay } from '../util.js';
import { confirmDialog, emptyState, setBusy, spinnerBlock, toast } from '../ui.js';
import { showReceipt } from './receipt.js';

const FILTERS = [
  ['todos', 'TODOS'],
  ['pendente', 'PENDENTES'],
  ['preparando', 'PREPARANDO'],
  ['entregue', 'ENTREGUES'],
  ['cancelado', 'CANCELADOS'],
];

const NEXT_STATUS = {
  pendente: { status: 'preparando', label: 'PREPARAR', iconName: 'flame' },
  preparando: { status: 'entregue', label: 'ENTREGAR', iconName: 'check' },
};

function actionsMarkup(order) {
  const next = NEXT_STATUS[order.status];
  const parts = [];
  if (next) {
    parts.push(
      `<button class="btn btn--primary btn--xs" type="button" data-action="advance" data-id="${order.id}" data-status="${next.status}">${icon(next.iconName, 13)} ${next.label}</button>`,
    );
    parts.push(
      `<button class="btn btn--danger-ghost btn--xs" type="button" data-action="cancel" data-id="${order.id}">${icon('x', 13)} CANCELAR</button>`,
    );
  }
  parts.push(
    `<button class="icon-btn icon-btn--bordered" type="button" data-action="print" data-id="${order.id}" aria-label="Imprimir pedido #${orderNumber(order.number)}">${icon('print', 15)}</button>`,
  );
  return parts.join('');
}

function orderMarkup(order) {
  const totalItems = order.items.reduce((sum, item) => sum + item.qty, 0);
  return `
    <article class="order-card order-card--${order.status}" data-order="${order.id}">
      <div class="order-card__top">
        <span class="order-card__num">#${orderNumber(order.number)}</span>
        <span class="status status--${order.status}">${STATUS_LABEL[order.status]}</span>
        <time class="order-card__time" datetime="${order.createdAt}">${timeOfDay(order.createdAt)}</time>
      </div>
      <div class="order-card__main">
        <div>
          <p class="order-card__customer">${escapeHtml(order.customer)}</p>
          <ul class="order-card__items">
            ${order.items.map((item) => `<li>${item.qty}x ${escapeHtml(item.name)}</li>`).join('')}
          </ul>
        </div>
        <div class="order-card__numbers">
          <span class="order-card__total">${money(order.total)}</span>
          <span class="order-card__pay">${PAYMENT_LABEL[order.payment] || order.payment}${order.payment === 'dinheiro' ? ` • troco ${money(order.change || 0)}` : ''}</span>
          <span class="order-card__count">${plural(totalItems, 'espetinho', 'espetinhos')}</span>
        </div>
      </div>
      <div class="order-card__foot">
        <span class="order-card__seller">${icon('users', 13)} ${escapeHtml(order.createdBy?.name || 'Equipe')}</span>
        <div class="order-card__actions">${actionsMarkup(order)}</div>
      </div>
    </article>
  `;
}

function listMarkup(orders) {
  if (!orders.length) {
    const filter = state.ui.ordersStatus;
    return emptyState({
      iconName: 'receipt',
      title: filter === 'todos' ? 'NENHUM PEDIDO AINDA' : 'NADA NESTE FILTRO',
      text:
        filter === 'todos'
          ? 'As vendas registradas pela equipe aparecem aqui.'
          : 'Tente outro filtro ou registre uma nova venda.',
      action: '<a class="btn btn--primary" href="#/cardapio">IR PARA O CARDÁPIO</a>',
    });
  }
  return orders.map(orderMarkup).join('');
}

function filterOrders(orders) {
  const status = state.ui.ordersStatus;
  const query = state.ui.ordersQuery.trim().toLowerCase();
  return orders.filter((order) => {
    if (status !== 'todos' && order.status !== status) return false;
    if (!query) return true;
    const number = orderNumber(order.number);
    return (
      number.includes(query.replace('#', '')) ||
      String(order.customer).toLowerCase().includes(query) ||
      String(order.createdBy?.name || '').toLowerCase().includes(query) ||
      order.items.some((item) => String(item.name).toLowerCase().includes(query))
    );
  });
}

export async function renderOrders(host, ctx) {
  if (!ctx.silent) {
    host.innerHTML = `<div class="orders-page" data-page>${spinnerBlock('BUSCANDO OS PEDIDOS...')}</div>`;
  }

  let data;
  try {
    data = await api.get('/api/orders?limit=300');
  } catch (error) {
    if (!ctx.isCurrent('pedidos')) return;
    if (ctx.silent) {
      toast(error.message, 'error');
      return;
    }
    host.innerHTML = `<div class="orders-page" data-page><div class="panel error-panel"><div class="panel__bar">ERRO</div><p>${error.message}</p><button class="btn" type="button" data-retry>TENTAR DE NOVO</button></div></div>`;
    host.querySelector('[data-retry]').addEventListener('click', () => renderOrders(host, ctx));
    return;
  }
  if (!ctx.isCurrent('pedidos')) return;

  const { orders, counts } = data;

  host.innerHTML = `
    <div class="orders-page" data-page>
      <div class="page-head">
        <div>
          <p class="eyebrow">COZINHA E ENTREGA</p>
          <h1>PEDIDOS</h1>
          <p class="page-sub"><span class="live-dot" aria-hidden="true"></span> Acompanhe e atualize cada pedido</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost btn--sm" type="button" data-action="refresh">${icon('refresh', 14)} ATUALIZAR</button>
          <a class="btn btn--primary" href="#/cardapio">${icon('plus', 14)} NOVA VENDA</a>
        </div>
      </div>

      <div class="orders-toolbar">
        <div class="filters" role="group" aria-label="Filtrar por status">
          ${FILTERS.map(
            ([value, label]) => `
              <button class="filter ${state.ui.ordersStatus === value ? 'is-active' : ''}" type="button" data-filter="${value}">
                ${label} <span>${counts[value] ?? 0}</span>
              </button>
            `,
          ).join('')}
        </div>
        <label class="search">
          <span class="search__icon">${icon('search', 17)}</span>
          <input class="input" type="search" placeholder="Buscar nº, cliente, vendedor..." value="${escapeHtml(state.ui.ordersQuery)}" data-search aria-label="Buscar pedidos">
        </label>
      </div>

      <div class="orders-list" data-orders-list>
        ${listMarkup(filterOrders(orders))}
      </div>
    </div>
  `;

  const page = host.querySelector('[data-page]');
  const list = page.querySelector('[data-orders-list]');
  const search = page.querySelector('[data-search]');

  function refreshList() {
    list.innerHTML = listMarkup(filterOrders(orders));
  }

  search.addEventListener('input', () => {
    state.ui.ordersQuery = search.value;
    refreshList();
  });

  for (const chip of page.querySelectorAll('[data-filter]')) {
    chip.addEventListener('click', () => {
      state.ui.ordersStatus = chip.dataset.filter;
      for (const other of page.querySelectorAll('[data-filter]')) {
        other.classList.toggle('is-active', other === chip);
      }
      refreshList();
    });
  }

  page.querySelector('[data-action="refresh"]').addEventListener('click', () => renderOrders(host, ctx));

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const order = orders.find((item) => item.id === id);
    if (!order) return;

    if (button.dataset.action === 'print') {
      showReceipt(order);
      return;
    }

    if (button.dataset.action === 'cancel') {
      const confirmed = await confirmDialog({
        title: 'CANCELAR PEDIDO',
        message: `Cancelar o pedido #${orderNumber(order.number)} de ${order.customer}? O estoque dos itens volta para o cardápio.`,
        confirmLabel: 'SIM, CANCELAR',
        cancelLabel: 'VOLTAR',
        danger: true,
      });
      if (!confirmed) return;
      setBusy(button, true, 'CANCELANDO...');
      try {
        await api.patch(`/api/orders/${id}/status`, { status: 'cancelado' });
        toast(`Pedido #${orderNumber(order.number)} cancelado. Estoque devolvido.`, 'ok');
        await renderOrders(host, ctx);
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
      return;
    }

    if (button.dataset.action === 'advance') {
      const next = button.dataset.status;
      setBusy(button, true, 'SALVANDO...');
      try {
        await api.patch(`/api/orders/${id}/status`, { status: next });
        toast(
          next === 'entregue' ? `Pedido #${orderNumber(order.number)} entregue!` : `Pedido #${orderNumber(order.number)} em preparo.`,
          'ok',
        );
        await renderOrders(host, ctx);
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    }
  });
}
