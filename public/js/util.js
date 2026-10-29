const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function money(cents) {
  const value = Number.isFinite(cents) ? cents : 0;
  return BRL.format(value / 100).replace(/\u00a0/g, ' ');
}

export function moneyInput(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
}

export function parseMoneyInput(value) {
  let text = String(value ?? '').replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!text) return null;
  if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/\.\d{3}(?:\D|$)/.test(text)) {
    text = text.replace(/\./g, '');
  }
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function orderNumber(number) {
  return String(number ?? 0).padStart(3, '0');
}

export function timeOfDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--/-- --:--';
  return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} • ${timeOfDay(iso)}`;
}

export function dateFull(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--/--/----';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export const STATUS_LABEL = {
  pendente: 'PENDENTE',
  preparando: 'PREPARANDO',
  entregue: 'ENTREGUE',
  cancelado: 'CANCELADO',
};

export const PAYMENT_LABEL = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
};

export function plural(count, singular, pluralWord) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function debounce(fn, delay = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
