import { escapeHtml } from './util.js';
import { icon } from './icons.js';

let toastRoot = null;
let modalCounter = 0;
const modalStack = [];

function ensureToastRoot() {
  if (!toastRoot) toastRoot = document.getElementById('toasts');
  return toastRoot;
}

const TOAST_ICON = { ok: 'check', error: 'alert', info: 'info' };

export function toast(message, type = 'ok', options = {}) {
  const root = ensureToastRoot();
  if (!root) return;
  const duration = options.duration ?? (type === 'error' ? 5200 : 3200);
  const element = document.createElement('div');
  element.className = `toast toast--${type}`;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
  element.innerHTML = `
    <span class="toast__icon">${icon(TOAST_ICON[type] || 'info', 18)}</span>
    <span class="toast__text">${escapeHtml(message)}</span>
    <button class="toast__close" type="button" aria-label="Fechar aviso">${icon('x', 14)}</button>
  `;
  const remove = () => {
    if (!element.isConnected) return;
    element.classList.add('is-leaving');
    setTimeout(() => element.remove(), 180);
  };
  element.querySelector('.toast__close').addEventListener('click', remove);
  root.appendChild(element);

  while (root.children.length > 4) root.firstElementChild?.remove();
  setTimeout(remove, duration);
  return remove;
}

function syncBodyLock() {
  if (modalStack.length) document.body.classList.add('has-modal');
  else document.body.classList.remove('has-modal');
}

/**
 * Abre um modal. Retorna { root, close }.
 * @param {{title?: string, body?: string|Node, actions?: Array<{label: string, kind?: string, onClick?: Function, autofocus?: boolean, id?: string}>, wide?: boolean, dismissible?: boolean, className?: string, onClose?: Function}} options
 */
export function openModal(options = {}) {
  const {
    title = '',
    body = '',
    actions = [],
    wide = false,
    dismissible = true,
    className = '',
    onClose = null,
  } = options;

  const previousFocus = document.activeElement;
  const id = `modal-title-${++modalCounter}`;
  const root = document.createElement('div');
  root.className = 'modal-backdrop';
  root.innerHTML = `
    <div class="modal ${wide ? 'modal--wide' : ''} ${className}" role="dialog" aria-modal="true" aria-labelledby="${id}" tabindex="-1">
      ${title ? `<div class="modal__bar"><h2 class="modal__title" id="${id}">${escapeHtml(title)}</h2>${dismissible ? `<button class="modal__x" type="button" data-modal-close aria-label="Fechar">${icon('x', 16)}</button>` : ''}</div>` : ''}
      <div class="modal__body"></div>
      <div class="modal__actions"></div>
    </div>
  `;

  const panel = root.querySelector('.modal');
  const bodyHost = root.querySelector('.modal__body');
  if (typeof body === 'string') bodyHost.innerHTML = body;
  else bodyHost.appendChild(body);

  const actionsHost = root.querySelector('.modal__actions');
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--${action.kind || 'ghost'} ${action.className || ''}`;
    button.innerHTML = action.label;
    if (action.id) button.id = action.id;
    if (action.autofocus) button.dataset.autofocus = 'true';
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      if (!action.onClick) {
        close();
        return;
      }
      const original = button.innerHTML;
      button.disabled = true;
      try {
        const result = await action.onClick(close);
        if (result !== false) close();
      } catch (error) {
        console.error(error);
        toast(error?.message || 'Não foi possível concluir.', 'error');
        button.disabled = false;
        button.innerHTML = original;
      }
    });
    actionsHost.appendChild(button);
  }
  if (!actions.length) actionsHost.remove();

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const index = modalStack.indexOf(instance);
    if (index >= 0) modalStack.splice(index, 1);
    root.classList.add('is-closing');
    setTimeout(() => root.remove(), 120);
    syncBodyLock();
    if (typeof onClose === 'function') onClose();
    if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) {
      setTimeout(() => previousFocus.focus(), 10);
    }
  }

  const instance = { root, close, panel };
  modalStack.push(instance);
  document.getElementById('modals')?.appendChild(root);
  syncBodyLock();

  root.addEventListener('mousedown', (event) => {
    if (event.target === root && dismissible) close();
  });
  root.querySelector('[data-modal-close]')?.addEventListener('click', close);

  // Foco inicial e navegação por teclado.
  setTimeout(() => {
    const target =
      panel.querySelector('[data-autofocus]') ||
      panel.querySelector('input:not([type=hidden]), select, textarea') ||
      panel.querySelector('.modal__actions .btn') ||
      panel;
    target?.focus?.();
  }, 30);

  return { root, close };
}

// Um único listener de teclado para a pilha de modais.
document.addEventListener('keydown', (event) => {
  if (!modalStack.length) return;
  const top = modalStack[modalStack.length - 1];
  if (event.key === 'Escape') {
    const backdrop = top.root;
    if (backdrop.querySelector('[data-modal-close]')) {
      event.preventDefault();
      top.close();
    }
    return;
  }
  if (event.key !== 'Tab') return;
  const focusables = top.panel.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

export function confirmDialog(options = {}) {
  const {
    title = 'Confirmar',
    message = '',
    confirmLabel = 'CONFIRMAR',
    cancelLabel = 'VOLTAR',
    danger = false,
    iconName = danger ? 'alert' : 'info',
  } = options;

  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      body: `
        <div class="confirm">
          <span class="confirm__icon confirm__icon--${danger ? 'danger' : 'info'}">${icon(iconName, 26)}</span>
          <p>${escapeHtml(message)}</p>
        </div>
      `,
      actions: [
        {
          label: escapeHtml(cancelLabel),
          kind: 'ghost',
          onClick: () => {
            answered = true;
            resolve(false);
          },
        },
        {
          label: escapeHtml(confirmLabel),
          kind: danger ? 'danger' : 'primary',
          autofocus: true,
          onClick: () => {
            answered = true;
            resolve(true);
          },
        },
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    return modal;
  });
}

export function setBusy(button, busy, label = 'AGUARDE...') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(label)}`;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

export function emptyState({ iconName = 'flame', title = 'Nada por aqui', text = '', action = '' }) {
  return `
    <div class="empty">
      <span class="empty__icon">${icon(iconName, 34)}</span>
      <h3>${escapeHtml(title)}</h3>
      ${text ? `<p>${escapeHtml(text)}</p>` : ''}
      ${action ? `<div class="empty__action">${action}</div>` : ''}
    </div>
  `;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function spinnerBlock(label = 'CARREGANDO...') {
  return `<div class="loading-block"><span class="spinner spinner--big" aria-hidden="true"></span><p>${escapeHtml(label)}</p></div>`;
}

export function fieldError(fields, name) {
  return fields && fields[name] ? `<span class="field__error">${escapeHtml(fields[name])}</span>` : '';
}
