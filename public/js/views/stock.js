import { icon } from '../icons.js';
import { state } from '../state.js';
import { money, moneyInput, parseMoneyInput } from '../util.js';
import { setBusy, spinnerBlock, toast } from '../ui.js';

function rowMarkup(product, canEdit) {
  const status =
    !product.available
      ? '<span class="stock-state stock-state--off">INDISPONÍVEL</span>'
      : product.stock <= 0
        ? '<span class="stock-state stock-state--out">ESGOTADO</span>'
        : product.stock <= 10
          ? '<span class="stock-state stock-state--low">ESTOQUE BAIXO</span>'
          : '<span class="stock-state stock-state--ok">DISPONÍVEL</span>';

  return `
    <form class="stock-row" data-id="${product.id}" novalidate>
      <div class="stock-row__product">
        <span class="stock-row__art"><img src="${product.image}" alt="" width="34" height="62"></span>
        <div>
          <strong>${product.shortName}</strong>
          <span class="stock-row__sold">${product.soldToday} vendidos hoje</span>
          ${status}
        </div>
      </div>
      <label class="field field--inline">
        <span class="field__label">PREÇO (R$)</span>
        <input class="input input--price" name="price" inputmode="decimal" value="${moneyInput(product.price)}" ${canEdit ? '' : 'disabled'} aria-label="Preço do espetinho de ${product.shortName}">
      </label>
      <label class="field field--inline">
        <span class="field__label">ESTOQUE</span>
        <span class="stock-input">
          <input class="input input--stock" name="stock" type="number" min="0" max="100000" step="1" value="${product.stock}" ${canEdit ? '' : 'disabled'} aria-label="Estoque do espetinho de ${product.shortName}">
          ${canEdit ? `<button class="chip chip--stock" type="button" data-add-stock="10" aria-label="Adicionar 10 ao estoque de ${product.shortName}">+10</button>` : ''}
        </span>
      </label>
      <label class="switch">
        <input type="checkbox" name="available" ${product.available ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
        <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
        <span class="switch__label">VENDER</span>
      </label>
      ${
        canEdit
          ? `<button class="btn btn--primary btn--sm stock-row__save" type="submit">${icon('check', 14)} SALVAR</button>`
          : '<span class="stock-row__readonly">SÓ LEITURA</span>'
      }
    </form>
  `;
}

export async function renderStock(host, ctx) {
  if (!ctx.silent) host.innerHTML = `<div class="stock-page" data-page>${spinnerBlock('CONTANDO OS ESPETINHOS...')}</div>`;

  let products;
  try {
    products = await ctx.refreshProducts();
  } catch (error) {
    if (!ctx.isCurrent('estoque')) return;
    if (ctx.silent) {
      toast(error.message, 'error');
      return;
    }
    host.innerHTML = `<div class="stock-page" data-page><div class="panel error-panel"><div class="panel__bar">ERRO</div><p>${error.message}</p><button class="btn" type="button" data-retry>TENTAR DE NOVO</button></div></div>`;
    host.querySelector('[data-retry]').addEventListener('click', () => renderStock(host, ctx));
    return;
  }
  if (!ctx.isCurrent('estoque')) return;

  const canEdit = state.user?.role === 'admin';
  const totalStock = products.reduce((sum, product) => sum + product.stock, 0);
  const potential = products.reduce((sum, product) => sum + product.stock * product.price, 0);
  const soldOut = products.filter((product) => !product.available || product.stock <= 0).length;

  host.innerHTML = `
    <div class="stock-page" data-page>
      <div class="page-head">
        <div>
          <p class="eyebrow">CARDÁPIO</p>
          <h1>PREÇOS E ESTOQUE</h1>
          <p class="page-sub"><span class="live-dot" aria-hidden="true"></span> Alterações valem para todos os aparelhos</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--ghost btn--sm" type="button" data-action="refresh">${icon('refresh', 14)} ATUALIZAR</button>
          <a class="btn btn--primary" href="#/cardapio">${icon('cart', 14)} VER CARDÁPIO</a>
        </div>
      </div>

      <div class="stock-summary">
        <div class="stock-summary__item"><span>${icon('box', 20)}</span><div><small>NO ESTOQUE</small><strong>${totalStock}</strong></div></div>
        <div class="stock-summary__item"><span>${icon('cash', 20)}</span><div><small>VALOR POTENCIAL</small><strong>${money(potential)}</strong></div></div>
        <div class="stock-summary__item"><span>${icon('alert', 20)}</span><div><small>ESGOTADOS</small><strong>${soldOut}</strong></div></div>
      </div>

      ${canEdit ? '<p class="admin-note">' + icon('info', 15) + ' Ajuste os preços combinados pela equipe antes de abrir a barraca. O estoque cai automaticamente a cada venda.</p>' : '<p class="admin-note admin-note--warn">' + icon('shield', 15) + ' Apenas administradores podem alterar preços e estoque.</p>'}

      <div class="panel stock-panel">
        <div class="panel__bar"><span>SABORES</span><span class="panel__bar-note">${products.length} ITENS</span></div>
        <div class="stock-list">
          ${products.map((product) => rowMarkup(product, canEdit)).join('')}
        </div>
      </div>
    </div>
  `;

  const page = host.querySelector('[data-page]');
  page.querySelector('[data-action="refresh"]').addEventListener('click', () => renderStock(host, ctx));

  for (const form of page.querySelectorAll('.stock-row')) {
    form.addEventListener('click', (event) => {
      const quick = event.target.closest('[data-add-stock]');
      if (!quick) return;
      const input = form.elements.stock;
      input.value = String(Math.max(0, Number(input.value || 0) + Number(quick.dataset.addStock || 10)));
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const id = form.dataset.id;
      const price = parseMoneyInput(form.elements.price.value);
      const stock = Number(form.elements.stock.value);
      if (price === null) {
        toast('Informe um preço válido, como 9,00.', 'error');
        form.elements.price.focus();
        return;
      }
      if (!Number.isInteger(stock) || stock < 0 || stock > 100000) {
        toast('Informe uma quantidade inteira de estoque.', 'error');
        form.elements.stock.focus();
        return;
      }
      const button = form.querySelector('.stock-row__save');
      setBusy(button, true, 'SALVANDO...');
      try {
        await ctx.api.patch(`/api/products/${id}`, {
          price,
          stock,
          available: form.elements.available.checked,
        });
        await ctx.refreshProducts();
        toast(`Preço e estoque de ${form.querySelector('strong').textContent} atualizados.`, 'ok');
        renderStock(host, ctx);
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    });
  }
}
