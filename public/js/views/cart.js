import { icon } from '../icons.js';
import {
  cartCount,
  cartLines,
  cartQty,
  cartTotal,
  clearCart,
  setCartQty,
  state,
} from '../state.js';
import { escapeHtml, money, moneyInput, parseMoneyInput, PAYMENT_LABEL } from '../util.js';
import { openModal, setBusy, spinnerBlock, toast } from '../ui.js';
import { showReceipt } from './receipt.js';

const draft = {
  customer: '',
  payment: 'pix',
  cash: '',
};

export function resetCartDraft() {
  draft.customer = '';
  draft.payment = 'pix';
  draft.cash = '';
}

function emptyMarkup() {
  return `
    <div class="cart-page" data-page>
      <div class="page-head">
        <div>
          <p class="eyebrow">PEDIDO</p>
          <h1>SEU CARRINHO</h1>
        </div>
      </div>
      <div class="panel empty-panel">
        <div class="empty">
          <span class="empty__icon">${icon('cart', 36)}</span>
          <h3>SEU PEDIDO ESTÁ VAZIO</h3>
          <p>Escolha seus espetinhos no cardápio para começar.</p>
          <div class="empty__action"><a class="btn btn--primary" href="#/cardapio">VER CARDÁPIO ${icon('arrowRight', 15)}</a></div>
        </div>
      </div>
    </div>
  `;
}

function lineMarkup(line) {
  return `
    <div class="cart-line" data-line="${line.product.id}">
      <div class="cart-line__art"><img src="${line.product.image}" alt="" width="48" height="87"></div>
      <div class="cart-line__info">
        <strong>${line.product.shortName || line.product.name}</strong>
        <span>${money(line.product.price)} cada</span>
      </div>
      <div class="stepper stepper--sm" role="group" aria-label="Quantidade de ${line.product.shortName}">
        <button class="stepper__btn" type="button" data-action="dec" data-id="${line.product.id}" aria-label="Remover um">${icon('minus', 13)}</button>
        <span class="stepper__value" data-qty>${line.qty}</span>
        <button class="stepper__btn" type="button" data-action="inc" data-id="${line.product.id}" aria-label="Adicionar um">${icon('plus', 13)}</button>
      </div>
      <div class="cart-line__subtotal" data-subtotal>${money(line.subtotal)}</div>
      <button class="icon-btn" type="button" data-action="remove" data-id="${line.product.id}" aria-label="Remover ${line.product.shortName} do pedido">${icon('trash', 16)}</button>
    </div>
  `;
}

function summaryMarkup() {
  const total = cartTotal();
  return `
    <aside class="panel checkout" aria-labelledby="checkout-title">
      <div class="panel__bar"><span id="checkout-title">FECHAMENTO</span><span class="panel__bar-dots" aria-hidden="true">▮▮</span></div>
      <div class="checkout__body">
        <label class="field">
          <span class="field__label">NOME DO CLIENTE <small>(OPCIONAL)</small></span>
          <input class="input" name="customer" maxlength="60" placeholder="Ex.: Ana" value="${escapeHtml(draft.customer)}" autocomplete="off">
        </label>

        <fieldset class="pay">
          <legend class="field__label">PAGAMENTO</legend>
          <div class="pay__options">
            <label class="pay__option ${draft.payment === 'pix' ? 'is-selected' : ''}">
              <input type="radio" name="payment" value="pix" ${draft.payment === 'pix' ? 'checked' : ''}>
              <span class="pay__icon">${icon('pix', 22)}</span>
              <span class="pay__name">PIX</span>
            </label>
            <label class="pay__option ${draft.payment === 'dinheiro' ? 'is-selected' : ''}">
              <input type="radio" name="payment" value="dinheiro" ${draft.payment === 'dinheiro' ? 'checked' : ''}>
              <span class="pay__icon">${icon('cash', 22)}</span>
              <span class="pay__name">DINHEIRO</span>
            </label>
          </div>
        </fieldset>

        <div class="cash" data-cash ${draft.payment === 'dinheiro' ? '' : 'hidden'}>
          <label class="field">
            <span class="field__label">VALOR RECEBIDO (R$)</span>
            <input class="input input--money" name="cash" inputmode="decimal" placeholder="0,00" value="${draft.cash}" autocomplete="off">
          </label>
          <div class="cash__quick" role="group" aria-label="Valores rápidos">
            <button class="chip chip--money" type="button" data-cash-quick="exact">EXATO</button>
            <button class="chip chip--money" type="button" data-cash-quick="2000">R$ 20</button>
            <button class="chip chip--money" type="button" data-cash-quick="5000">R$ 50</button>
            <button class="chip chip--money" type="button" data-cash-quick="10000">R$ 100</button>
          </div>
          <div class="cash__change" data-change-box>
            <span data-change-label>TROCO</span>
            <strong data-change-value>R$ 0,00</strong>
          </div>
        </div>

        <div class="checkout__total">
          <span>TOTAL</span>
          <strong data-total>${money(total)}</strong>
        </div>
        <button class="btn btn--primary btn--block btn--lg" type="button" data-checkout>CONFIRMAR VENDA ${icon('arrowRight', 16)}</button>
        <p class="checkout__note">${icon('shield', 13)} O estoque é atualizado na hora para toda a equipe.</p>
      </div>
    </aside>
  `;
}

function showSuccess(order, host, ctx) {
  const payment = PAYMENT_LABEL[order.payment] || order.payment;
  const change = order.payment === 'dinheiro' ? money(order.change || 0) : null;
  openModal({
    title: 'VENDA CONFIRMADA!',
    className: 'modal--success',
    dismissible: false,
    body: `
      <div class="sale-success">
        <span class="sale-success__spark" aria-hidden="true">✦</span>
        <p class="sale-success__kicker">PEDIDO</p>
        <p class="sale-success__number">#${String(order.number).padStart(3, '0')}</p>
        <p class="sale-success__total">${money(order.total)}</p>
        <div class="sale-success__meta">
          <span>${payment}</span>
          ${change ? `<span>TROCO ${change}</span>` : ''}
        </div>
        <p class="sale-success__hint">Anote o número e entregue ao cliente.</p>
      </div>
    `,
    actions: [
      {
        label: `${icon('print', 15)} IMPRIMIR`,
        kind: 'ghost',
        onClick: () => {
          showReceipt(order);
          return false;
        },
      },
      {
        label: `${icon('receipt', 15)} VER PEDIDOS`,
        kind: 'dark',
        onClick: (close) => {
          close();
          ctx.navigate('pedidos');
        },
      },
      {
        label: `NOVA VENDA ${icon('arrowRight', 15)}`,
        kind: 'primary',
        autofocus: true,
        onClick: (close) => {
          close();
          ctx.navigate('cardapio');
        },
      },
    ],
  });
}

export async function renderCart(host, ctx) {
  host.innerHTML = `<div class="cart-page" data-page>${spinnerBlock('CONFERINDO O PEDIDO...')}</div>`;

  let products;
  try {
    products = await ctx.refreshProducts();
  } catch (error) {
    if (!ctx.isCurrent('carrinho')) return;
    const page = host.querySelector('[data-page]');
    page.innerHTML = `
      <div class="panel error-panel">
        <div class="panel__bar">ERRO</div>
        <p>${error.message}</p>
        <button class="btn" type="button" data-retry>TENTAR DE NOVO</button>
      </div>
    `;
    page.querySelector('[data-retry]').addEventListener('click', () => renderCart(host, ctx));
    return;
  }
  if (!ctx.isCurrent('carrinho')) return;

  if (!cartLines().length) {
    host.innerHTML = emptyMarkup();
    return;
  }
  const total = cartTotal();
  if (!draft.cash) draft.cash = moneyInput(total);

  const lines = cartLines();
  host.innerHTML = `
    <div class="cart-page" data-page>
      <div class="page-head">
        <div>
          <p class="eyebrow">PEDIDO</p>
          <h1>SEU CARRINHO</h1>
          <p class="page-sub">${lines.length} ${lines.length === 1 ? 'sabor' : 'sabores'} • ${cartCount()} ${cartCount() === 1 ? 'espetinho' : 'espetinhos'}</p>
        </div>
        <div class="page-actions">
          <a class="btn btn--ghost btn--sm" href="#/cardapio">${icon('plus', 14)} ADICIONAR MAIS</a>
        </div>
      </div>

      <div class="cart-layout">
        <section class="panel cart-list" aria-labelledby="cart-items-title">
          <div class="panel__bar"><span id="cart-items-title">ITENS DO PEDIDO</span><span class="panel__bar-dots" aria-hidden="true">▮▮▮</span></div>
          <div class="cart-list__body">
            ${lines.map(lineMarkup).join('')}
          </div>
        </section>
        ${summaryMarkup()}
      </div>
    </div>
  `;

  const page = host.querySelector('[data-page]');
  const cashInput = page.querySelector('input[name="cash"]');
  const customerInput = page.querySelector('input[name="customer"]');
  const totalEl = page.querySelector('[data-total]');
  const changeBox = page.querySelector('[data-change-box]');
  const changeLabel = page.querySelector('[data-change-label]');
  const changeValue = page.querySelector('[data-change-value]');
  const checkoutButton = page.querySelector('[data-checkout]');

  customerInput.addEventListener('input', () => {
    draft.customer = customerInput.value;
  });

  function updateChange() {
    const currentTotal = cartTotal();
    const cash = parseMoneyInput(cashInput.value);
    const received = cash ?? 0;
    const diff = received - currentTotal;
    changeBox.classList.toggle('is-short', diff < 0);
    changeLabel.textContent = diff < 0 ? 'FALTA' : 'TROCO';
    changeValue.textContent = money(Math.abs(diff));
    cashInput.setAttribute('aria-invalid', diff < 0 ? 'true' : 'false');
  }

  function syncTotals() {
    const currentTotal = cartTotal();
    totalEl.textContent = money(currentTotal);
    for (const line of cartLines()) {
      const row = page.querySelector(`[data-line="${line.product.id}"]`);
      if (!row) continue;
      row.querySelector('[data-qty]').textContent = String(line.qty);
      row.querySelector('[data-subtotal]').textContent = money(line.subtotal);
    }
    if (cashInput && !cashInput.value) draft.cash = moneyInput(currentTotal);
    updateChange();
    ctx.updateCartBadge();
  }

  cashInput.addEventListener('input', () => {
    draft.cash = cashInput.value;
    updateChange();
  });

  for (const radio of page.querySelectorAll('input[name="payment"]')) {
    radio.addEventListener('change', () => {
      draft.payment = radio.value;
      for (const option of page.querySelectorAll('.pay__option')) {
        option.classList.toggle('is-selected', option.querySelector('input').checked);
      }
      page.querySelector('[data-cash]').hidden = draft.payment !== 'dinheiro';
      if (draft.payment === 'dinheiro' && !cashInput.value) {
        cashInput.value = moneyInput(cartTotal());
        draft.cash = cashInput.value;
      }
      updateChange();
    });
  }

  for (const button of page.querySelectorAll('[data-cash-quick]')) {
    button.addEventListener('click', () => {
      const quick = button.dataset.cashQuick;
      const value = quick === 'exact' ? cartTotal() : Number(quick);
      cashInput.value = moneyInput(value);
      draft.cash = cashInput.value;
      updateChange();
      cashInput.focus();
    });
  }

  page.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const id = action.dataset.id;
    if (!id) return;
    const product = state.products.find((item) => item.id === id);
    if (!product) return;
    if (action.dataset.action === 'remove') {
      setCartQty(id, 0);
    } else if (action.dataset.action === 'inc') {
      if (cartQty(id) >= product.stock) {
        toast(`Só restam ${product.stock} de ${product.shortName}.`, 'error');
        return;
      }
      setCartQty(id, cartQty(id) + 1);
    } else if (action.dataset.action === 'dec') {
      setCartQty(id, cartQty(id) - 1);
    }
    if (!cartCount()) {
      renderCart(host, ctx);
      return;
    }
    const row = page.querySelector(`[data-line="${id}"]`);
    if (row && cartQty(id) <= 0) row.remove();
    syncTotals();
  });

  checkoutButton.addEventListener('click', async () => {
    const linesNow = cartLines();
    if (!linesNow.length) {
      renderCart(host, ctx);
      return;
    }
    const currentTotal = cartTotal();
    const payment = draft.payment;
    let cashGiven = null;
    if (payment === 'dinheiro') {
      cashGiven = parseMoneyInput(cashInput.value);
      if (cashGiven === null) {
        toast('Informe o valor recebido em dinheiro.', 'error');
        cashInput.focus();
        return;
      }
      if (cashGiven < currentTotal) {
        toast(`Faltam ${money(currentTotal - cashGiven)} para fechar a venda.`, 'error');
        cashInput.focus();
        return;
      }
    }

    setBusy(checkoutButton, true, 'REGISTRANDO...');
    try {
      const result = await ctx.api.post('/api/orders', {
        customer: draft.customer.trim(),
        payment,
        expectedTotal: currentTotal,
        cashGiven: payment === 'dinheiro' ? cashGiven : undefined,
        items: linesNow.map((line) => ({ productId: line.product.id, qty: line.qty })),
      });
      clearCart();
      resetCartDraft();
      ctx.updateCartBadge();
      ctx.refreshProducts().catch(() => {});
      showSuccess(result.order, host, ctx);
    } catch (error) {
      if (error.code === 'price_changed' || error.code === 'insufficient_stock' || error.code === 'unavailable') {
        await ctx.refreshProducts().catch(() => {});
        toast(error.message, 'error');
        if (ctx.isCurrent('carrinho')) renderCart(host, ctx);
      } else if (error.status === 401) {
        /* tratado pelo app */
      } else {
        toast(error.message || 'Não foi possível registrar a venda.', 'error');
        setBusy(checkoutButton, false);
      }
    }
  });

  updateChange();
}
