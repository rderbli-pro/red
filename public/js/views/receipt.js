import { icon } from '../icons.js';
import { dateFull, money, orderNumber, PAYMENT_LABEL, timeOfDay } from '../util.js';
import { openModal } from '../ui.js';

export function showReceipt(order) {
  const isCash = order.payment === 'dinheiro';
  const body = `
    <div class="receipt-wrap">
      <div id="recibo" class="receipt">
        <div class="receipt__head">
          <img src="/assets/logo-rasec.svg" alt="" width="58" height="58">
          <div class="receipt__brand">
            <strong>RASEC</strong>
            <span>ESPETINHOS</span>
            <small>C.E.P.K • Feira de Empreendedorismo</small>
          </div>
        </div>
        <div class="receipt__sep"></div>
        <div class="receipt__number">
          <span>PEDIDO</span>
          <strong>#${orderNumber(order.number)}</strong>
        </div>
        <div class="receipt__row"><span>Data</span><span>${dateFull(order.createdAt)} • ${timeOfDay(order.createdAt)}</span></div>
        <div class="receipt__row"><span>Cliente</span><span>${order.customer}</span></div>
        <div class="receipt__row"><span>Vendedor</span><span>${order.createdBy?.name || 'Equipe'}</span></div>
        <div class="receipt__sep"></div>
        <table class="receipt__table">
          <thead><tr><th>ITEM</th><th>QTD</th><th>VALOR</th></tr></thead>
          <tbody>
            ${order.items
              .map(
                (item) => `<tr>
                  <td>${item.name}</td>
                  <td>${item.qty}</td>
                  <td>${money(item.price * item.qty)}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
        <div class="receipt__sep"></div>
        <div class="receipt__total"><span>TOTAL</span><strong>${money(order.total)}</strong></div>
        <div class="receipt__row"><span>Pagamento</span><span>${PAYMENT_LABEL[order.payment] || order.payment}</span></div>
        ${
          isCash
            ? `<div class="receipt__row"><span>Recebido</span><span>${money(order.cashGiven || 0)}</span></div>
               <div class="receipt__row"><span>Troco</span><span>${money(order.change || 0)}</span></div>`
            : ''
        }
        <div class="receipt__thanks">OBRIGADO PELA PREFERÊNCIA!</div>
        <div class="receipt__handle">@rasec.espetinhos</div>
      </div>
    </div>
  `;

  openModal({
    title: 'COMPROVANTE DA VENDA',
    body,
    dismissible: true,
    className: 'modal--receipt',
    actions: [
      {
        label: `${icon('x', 14)} FECHAR`,
        kind: 'ghost',
      },
      {
        label: `${icon('print', 15)} IMPRIMIR`,
        kind: 'primary',
        onClick: () => {
          window.print();
          return false;
        },
      },
    ],
  });
}
