import { api } from '../api.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import {
  dateTime,
  escapeHtml,
  money,
  orderNumber,
  plural,
  STATUS_LABEL,
  timeOfDay,
} from '../util.js';
import { emptyState, spinnerBlock, toast } from '../ui.js';

function kpiCard({ label, value, foot, iconName, tone = '' }) {
  return `
    <div class="kpi ${tone ? `kpi--${tone}` : ''}">
      <span class="kpi__icon">${icon(iconName, 24)}</span>
      <div class="kpi__body">
        <span class="kpi__label">${label}</span>
        <strong class="kpi__value">${value}</strong>
        <span class="kpi__foot">${foot}</span>
      </div>
    </div>
  `;
}

function alertMarkup(stats) {
  const items = [];
  if (stats.alerts.pendingOrders > 0) {
    items.push(`
      <button class="alert alert--gold" type="button" data-go="pedidos" data-status="pendente">
        <span class="alert__icon">${icon('clock', 20)}</span>
        <span><strong>${plural(stats.alerts.pendingOrders, 'pedido aguardando', 'pedidos aguardando')}</strong> preparo</span>
        ${icon('arrowRight', 15)}
      </button>
    `);
  }
  if (stats.alerts.lowStock > 0) {
    items.push(`
      <button class="alert alert--red" type="button" data-go="estoque">
        <span class="alert__icon">${icon('alert', 20)}</span>
        <span><strong>Estoque baixo:</strong> ${stats.lowStock.map((item) => `${item.name} (${item.stock})`).join(', ')}</span>
        ${icon('arrowRight', 15)}
      </button>
    `);
  }
  if (stats.alerts.defaultPasswords > 0 && state.user?.role === 'admin') {
    items.push(`
      <button class="alert alert--dark" type="button" data-go="equipe">
        <span class="alert__icon">${icon('key', 20)}</span>
        <span><strong>${plural(stats.alerts.defaultPasswords, 'conta ainda usa', 'contas ainda usam')}</strong> a senha inicial.</span>
        ${icon('arrowRight', 15)}
      </button>
    `);
  }
  return items.length ? `<div class="alerts">${items.join('')}</div>` : '';
}

function chartMarkup(stats) {
  const hours = stats.byHour.filter((entry) => entry.hour >= 8 && entry.hour <= 21);
  const max = Math.max(1, ...hours.map((entry) => entry.revenue));
  const total = hours.reduce((sum, entry) => sum + entry.revenue, 0);
  if (!total) {
    return `<div class="panel chart-panel"><div class="panel__bar"><span>VENDAS POR HORA</span></div><div class="panel__pad">${emptyState({ iconName: 'chart', title: 'SEM VENDAS AINDA', text: 'O gráfico aparece assim que a primeira venda do dia for registrada.' })}</div></div>`;
  }
  return `
    <div class="panel chart-panel">
      <div class="panel__bar"><span>VENDAS POR HORA</span><span class="panel__bar-note">HOJE</span></div>
      <div class="panel__pad">
        <div class="chart" role="img" aria-label="Vendas por hora de hoje">
          ${hours
            .map((entry) => {
              const height = entry.revenue ? Math.max(4, Math.round((entry.revenue / max) * 100)) : 2;
              return `
                <div class="chart__col" title="${entry.hour}h • ${plural(entry.orders, 'pedido', 'pedidos')} • ${money(entry.revenue)}">
                  <div class="chart__track"><span class="chart__bar ${entry.revenue ? '' : 'is-empty'}" style="height:${height}%"></span></div>
                  <span class="chart__hour">${entry.hour % 2 === 0 ? `${entry.hour}h` : ''}</span>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function flavorsMarkup(stats) {
  const maxQty = Math.max(1, ...stats.byFlavor.map((item) => item.qty));
  return `
    <div class="panel flavors-panel">
      <div class="panel__bar"><span>SABORES</span><span class="panel__bar-note">HOJE</span></div>
      <div class="panel__pad flavor-list">
        ${stats.byFlavor
          .map(
            (item) => `
              <div class="flavor">
                <span class="flavor__art"><img src="/assets/espeto-${item.id}.svg" alt="" width="26" height="47"></span>
                <div class="flavor__body">
                  <div class="flavor__top">
                    <strong>${item.name}</strong>
                    <span>${item.qty} un • ${money(item.revenue)}</span>
                  </div>
                  <div class="bar"><span style="width:${Math.round((item.qty / maxQty) * 100)}%"></span></div>
                  <span class="flavor__stock">${item.stock} em estoque</span>
                </div>
              </div>
            `,
          )
          .join('')}
      </div>
    </div>
  `;
}

function paymentsMarkup(stats) {
  const total = stats.byPayment.reduce((sum, item) => sum + item.revenue, 0);
  return `
    <div class="panel payments-panel">
      <div class="panel__bar"><span>PAGAMENTOS</span><span class="panel__bar-note">HOJE</span></div>
      <div class="panel__pad payment-list">
        ${stats.byPayment
          .map((item) => {
            const pct = total ? Math.round((item.revenue / total) * 100) : 0;
            return `
              <div class="payment">
                <span class="payment__icon">${icon(item.payment === 'pix' ? 'pix' : 'cash', 22)}</span>
                <div class="payment__body">
                  <div class="payment__top"><strong>${item.label}</strong><span>${item.orders} ${item.orders === 1 ? 'pedido' : 'pedidos'}</span></div>
                  <div class="bar"><span style="width:${pct}%"></span></div>
                </div>
                <span class="payment__value">${money(item.revenue)}</span>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function rankingMarkup(stats) {
  return `
    <div class="panel ranking-panel">
      <div class="panel__bar"><span>EQUIPE</span><span class="panel__bar-note">HOJE</span></div>
      <div class="panel__pad">
        ${
          stats.bySeller.length
            ? `<ol class="ranking">
                ${stats.bySeller
                  .map(
                    (seller, index) => `
                      <li>
                        <span class="ranking__pos">${index + 1}º</span>
                        <span class="ranking__name">${escapeHtml(seller.name)}</span>
                        <span class="ranking__meta">${plural(seller.orders, 'pedido', 'pedidos')}</span>
                        <strong>${money(seller.revenue)}</strong>
                      </li>
                    `,
                  )
                  .join('')}
              </ol>`
            : emptyState({ iconName: 'users', title: 'NINGUÉM VENDEU AINDA', text: 'O ranking do dia começa na primeira venda.' })
        }
      </div>
    </div>
  `;
}

function recentMarkup(stats) {
  if (!stats.recentOrders.length) {
    return `
      <div class="panel recent-panel">
        <div class="panel__bar"><span>ÚLTIMOS PEDIDOS</span></div>
        <div class="panel__pad">${emptyState({ iconName: 'receipt', title: 'NENHUM PEDIDO', text: 'As vendas aparecem aqui em tempo real.', action: '<a class="btn btn--primary" href="#/cardapio">ABRIR CARDÁPIO</a>' })}</div>
      </div>
    `;
  }
  return `
    <div class="panel recent-panel">
      <div class="panel__bar"><span>ÚLTIMOS PEDIDOS</span><button class="panel__bar-link" type="button" data-go="pedidos">VER TODOS ${icon('arrowRight', 12)}</button></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>PEDIDO</th><th>HORA</th><th>CLIENTE</th><th>ITENS</th><th>TOTAL</th><th>STATUS</th></tr></thead>
          <tbody>
            ${stats.recentOrders
              .map(
                (order) => `
                  <tr class="table__row" data-go="pedidos">
                    <td data-label="Pedido"><strong>#${orderNumber(order.number)}</strong></td>
                    <td data-label="Hora">${timeOfDay(order.createdAt)}</td>
                    <td data-label="Cliente">${escapeHtml(order.customer)}</td>
                    <td data-label="Itens">${order.items.reduce((sum, item) => sum + item.qty, 0)}</td>
                    <td data-label="Total"><strong>${money(order.total)}</strong></td>
                    <td data-label="Status"><span class="status status--${order.status}">${STATUS_LABEL[order.status]}</span></td>
                  </tr>
                `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export async function renderDashboard(host, ctx) {
  host.innerHTML = `<div class="dashboard-page" data-page>${spinnerBlock('CARREGANDO O PAINEL...')}</div>`;

  let stats;
  try {
    const result = await api.get('/api/stats');
    stats = result.stats;
  } catch (error) {
    if (!ctx.isCurrent('painel')) return;
    const page = host.querySelector('[data-page]');
    page.innerHTML = `<div class="panel error-panel"><div class="panel__bar">ERRO</div><p>${error.message}</p><button class="btn" type="button" data-retry>TENTAR DE NOVO</button></div>`;
    page.querySelector('[data-retry]').addEventListener('click', () => renderDashboard(host, ctx));
    return;
  }
  if (!ctx.isCurrent('painel')) return;

  const today = new Date(stats.serverTime);
  const dateLabel = today.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const updated = timeOfDay(stats.serverTime);
  const pending = stats.today.pending;
  const preparing = stats.today.preparing;

  host.innerHTML = `
    <div class="dashboard-page" data-page>
      <div class="page-head">
        <div>
          <p class="eyebrow">GESTÃO • ${escapeHtml(dateLabel.toUpperCase())}</p>
          <h1>PAINEL DA BARRACA</h1>
          <p class="page-sub"><span class="live-dot" aria-hidden="true"></span> Atualizado às ${updated} • sincroniza sozinho</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost btn--sm" type="button" data-action="refresh" aria-label="Atualizar painel">${icon('refresh', 14)} ATUALIZAR</button>
          <a class="btn btn--primary" href="#/cardapio">${icon('plus', 14)} NOVA VENDA</a>
        </div>
      </div>

      ${alertMarkup(stats)}

      <div class="kpi-grid">
        ${kpiCard({ label: 'VENDAS HOJE', value: money(stats.today.revenue), foot: `${plural(stats.today.orders, 'pedido', 'pedidos')} hoje`, iconName: 'chart', tone: 'red' })}
        ${kpiCard({ label: 'PEDIDOS', value: String(stats.today.orders), foot: `${pending} pendentes • ${preparing} preparando`, iconName: 'receipt' })}
        ${kpiCard({ label: 'TICKET MÉDIO', value: money(stats.today.ticket), foot: 'por pedido', iconName: 'star' })}
        ${kpiCard({ label: 'ESPETINHOS', value: String(stats.today.items), foot: `${stats.today.cancelled} cancelados hoje`, iconName: 'flame', tone: 'gold' })}
      </div>

      <div class="dash-grid">
        ${chartMarkup(stats)}
        ${flavorsMarkup(stats)}
        ${paymentsMarkup(stats)}
        ${rankingMarkup(stats)}
      </div>

      ${recentMarkup(stats)}

      <div class="dash-foot">
        <span>${icon('shield', 14)} Dados salvos no servidor da barraca.</span>
        ${
          state.user?.role === 'admin'
            ? `<div class="dash-foot__actions">
                 <button class="btn btn--ghost btn--sm" type="button" data-action="export">${icon('download', 14)} EXPORTAR CSV</button>
               </div>`
            : ''
        }
      </div>
    </div>
  `;

  const page = host.querySelector('[data-page]');
  page.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'refresh') {
      renderDashboard(host, ctx);
      return;
    }
    if (action === 'export') {
      api.download('/api/orders/export.csv');
      toast('Download do CSV iniciado.', 'ok');
      return;
    }
    const go = event.target.closest('[data-go]');
    if (go) {
      const route = go.dataset.go;
      if (route === 'pedidos' && go.dataset.status) state.ui.ordersStatus = go.dataset.status;
      if (route === 'pedidos' && !go.dataset.status) state.ui.ordersStatus = 'todos';
      ctx.navigate(route);
    }
  });
}
