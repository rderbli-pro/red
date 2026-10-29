import { icon } from '../icons.js';
import { cartCount, cartQty, cartTotal, addToCart, state } from '../state.js';
import { money, plural } from '../util.js';
import { spinnerBlock, toast } from '../ui.js';

function heroMarkup() {
  return `
    <section class="hero" aria-labelledby="hero-title">
      <span class="hero__hatch" aria-hidden="true"></span>
      <div class="hero__logo-wrap">
        <img class="hero__logo" src="/assets/logo-rasec.svg" alt="Rosto do mascote Rasec" width="128" height="128">
      </div>
      <div class="hero__copy">
        <p class="hero__kicker">C.E.P.K • FEIRA DE EMPREENDEDORISMO</p>
        <h1 class="hero__title" id="hero-title">RASEC</h1>
        <p class="hero__subtitle">ESPETINHOS</p>
        <p class="hero__text">Carne, frango e linguiça na brasa. Feito na hora, do jeito que você gosta.</p>
        <ul class="hero__chips" aria-label="Sabores">
          <li>CARNE</li>
          <li>FRANGO</li>
          <li>LINGUIÇA</li>
        </ul>
      </div>
      <div class="hero__art" aria-hidden="true">
        <span class="hero__burst"></span>
        <img src="/assets/espeto-linguica.svg" alt="" width="118" height="214">
      </div>
      <span class="hero__ribbon" aria-hidden="true">NOVO!</span>
      <div class="hero__marquee" aria-hidden="true">
        <div class="hero__marquee-track">
          <span>NA BRASA • FEITO NA HORA • CARNE • FRANGO • LINGUIÇA • NA BRASA • FEITO NA HORA • CARNE • FRANGO • LINGUIÇA • </span>
          <span>NA BRASA • FEITO NA HORA • CARNE • FRANGO • LINGUIÇA • NA BRASA • FEITO NA HORA • CARNE • FRANGO • LINGUIÇA • </span>
        </div>
      </div>
    </section>
  `;
}

function actionMarkup(product) {
  if (product.isSoldOut) {
    return `<button class="btn btn--dark btn--block" type="button" disabled>${icon('x', 14)} ESGOTADO</button>`;
  }
  const qty = cartQty(product.id);
  if (qty <= 0) {
    return `<button class="btn btn--primary btn--block" type="button" data-action="add" data-id="${product.id}">${icon('plus', 15)} ADICIONAR</button>`;
  }
  return `
    <div class="product__qty">
      <span class="product__qty-label">NO PEDIDO</span>
      <div class="stepper" role="group" aria-label="Quantidade de ${product.shortName || product.name}">
        <button type="button" class="stepper__btn" data-action="dec" data-id="${product.id}" aria-label="Remover um ${product.shortName || product.name}">${icon('minus', 14)}</button>
        <span class="stepper__value" aria-live="polite">${qty}</span>
        <button type="button" class="stepper__btn" data-action="inc" data-id="${product.id}" aria-label="Adicionar um ${product.shortName || product.name}">${icon('plus', 14)}</button>
      </div>
    </div>
  `;
}

function cardMarkup(product, index) {
  const qty = cartQty(product.id);
  const stockLabel =
    product.stock <= 0
      ? 'SEM ESTOQUE'
      : product.stock <= 10
        ? `ÚLTIMAS ${product.stock} UNIDADES`
        : `ESTOQUE: ${product.stock}`;
  const badges = [];
  if (index === 0 && !product.isSoldOut) badges.push('<span class="product__badge">MAIS PEDIDO</span>');
  if (product.stock > 0 && product.stock <= 10) badges.push('<span class="product__badge product__badge--alert">ÚLTIMAS!</span>');

  return `
    <article class="product ${product.isSoldOut ? 'is-soldout' : ''} ${qty ? 'is-in-cart' : ''}" data-card="${product.id}">
      <div class="product__art">
        ${badges.join('')}
        <img src="${product.image}" alt="Espetinho de ${product.shortName || product.name}" width="112" height="203" loading="lazy">
        ${product.isSoldOut ? '<span class="product__soldout">ESGOTADO</span>' : ''}
      </div>
      <div class="product__body">
        <div class="product__heading">
          <h3>${product.shortName || product.name}</h3>
          <span class="product__price">${money(product.price)}</span>
        </div>
        <p class="product__desc">${product.description}</p>
        <p class="product__stock ${product.stock <= 10 ? 'is-low' : ''}">${stockLabel}</p>
        <div class="product__actions">${actionMarkup(product)}</div>
      </div>
    </article>
  `;
}

function cartBarMarkup() {
  const count = cartCount();
  const total = cartTotal();
  return `
    <div class="cart-bar" data-cart-bar ${count ? '' : 'hidden'}>
      <div class="cart-bar__info">
        <span class="cart-bar__icon">${icon('cart', 20)}</span>
        <span><strong data-cart-count>${count}</strong> <span data-cart-word>${count === 1 ? 'espetinho' : 'espetinhos'}</span></span>
      </div>
      <div class="cart-bar__total"><span>TOTAL</span><strong data-cart-total>${money(total)}</strong></div>
      <a class="btn btn--primary cart-bar__go" href="#/carrinho">VER PEDIDO ${icon('arrowRight', 15)}</a>
    </div>
  `;
}

function updateCartBar(host) {
  const bar = host.querySelector('[data-cart-bar]');
  if (!bar) return;
  const count = cartCount();
  bar.hidden = count === 0;
  bar.querySelector('[data-cart-count]').textContent = String(count);
  bar.querySelector('[data-cart-word]').textContent = count === 1 ? 'espetinho' : 'espetinhos';
  bar.querySelector('[data-cart-total]').textContent = money(cartTotal());
}

export async function renderMenu(host, ctx) {
  host.innerHTML = `
    <div class="menu-page" data-page>
      ${heroMarkup()}
      <div class="section-head">
        <div>
          <p class="eyebrow">MONTE SEU PEDIDO</p>
          <h2>CARDÁPIO</h2>
        </div>
        <span class="section-head__note">${icon('flame', 16)} 3 sabores na brasa</span>
      </div>
      ${spinnerBlock('ACENDENDO A CHURRASQUEIRA...')}
    </div>
  `;

  let products;
  try {
    products = await ctx.refreshProducts();
  } catch (error) {
    if (!ctx.isCurrent('cardapio')) return;
    const page = host.querySelector('[data-page]');
    page?.querySelector('.loading-block')?.remove();
    page?.insertAdjacentHTML(
      'beforeend',
      `<div class="panel error-panel"><div class="panel__bar">ERRO</div><p>${error.message}</p><button class="btn" data-action="retry">TENTAR DE NOVO</button></div>`,
    );
    page?.querySelector('[data-action="retry"]')?.addEventListener('click', () => renderMenu(host, ctx));
    return;
  }
  if (!ctx.isCurrent('cardapio')) return;

  host.innerHTML = `
    <div class="menu-page" data-page>
      ${heroMarkup()}
      <div class="section-head">
        <div>
          <p class="eyebrow">MONTE SEU PEDIDO</p>
          <h2>CARDÁPIO</h2>
        </div>
        <div class="section-head__actions">
          <span class="section-head__note">${icon('flame', 16)} 3 sabores na brasa</span>
          <button class="btn btn--ghost btn--sm" type="button" data-action="refresh" aria-label="Atualizar cardápio">${icon('refresh', 14)} ATUALIZAR</button>
        </div>
      </div>
      <div class="product-grid">
        ${products.map((product, index) => cardMarkup(product, index)).join('')}
      </div>
      <div class="tip-card">
        <span class="tip-card__icon">${icon('info', 22)}</span>
        <p><strong>DICA:</strong> toque em <em>ADICIONAR</em> para montar o pedido. Você pode escolher vários sabores no mesmo pedido.</p>
      </div>
      ${cartBarMarkup()}
      <p class="sr-only" aria-live="polite" data-cart-live></p>
    </div>
  `;

  const page = host.querySelector('[data-page]');
  const live = page.querySelector('[data-cart-live]');
  updateCartBar(page);

  function updateCard(id) {
    const product = state.products.find((item) => item.id === id);
    const card = page.querySelector(`[data-card="${id}"]`);
    if (!product || !card) return;
    const qty = cartQty(id);
    card.classList.toggle('is-in-cart', qty > 0);
    const actions = card.querySelector('.product__actions');
    if (actions) actions.innerHTML = actionMarkup(product);
  }

  function bump(id) {
    const art = page.querySelector(`[data-card="${id}"] .product__art`);
    if (!art) return;
    art.classList.remove('is-bump');
    void art.offsetWidth;
    art.classList.add('is-bump');
  }

  page.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'refresh') {
      renderMenu(host, ctx);
      return;
    }
    const id = target.dataset.id;
    if (!id) return;
    const product = state.products.find((item) => item.id === id);
    if (!product) return;

    if (action === 'add' || action === 'inc') {
      const before = cartQty(id);
      if (before >= product.stock) {
        toast(`Só restam ${product.stock} de ${product.shortName}.`, 'error');
        return;
      }
      addToCart(id, 1);
      live.textContent = `${product.shortName} adicionado. ${cartCount()} itens no pedido.`;
      bump(id);
      updateCard(id);
      updateCartBar(page);
      ctx.updateCartBadge();
    }
    if (action === 'dec') {
      addToCart(id, -1);
      live.textContent = `${product.shortName} removido. ${cartCount()} itens no pedido.`;
      updateCard(id);
      updateCartBar(page);
      ctx.updateCartBadge();
    }
  });

  // Revalida o cardápio ao voltar para a aba, sem atrapalhar quem está montando o pedido.
  state.products = products;
}
