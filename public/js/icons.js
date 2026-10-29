const PATHS = {
  cart: `
    <path d="M3 4h3l2.2 10.5h9.6L20 7H6.4"/>
    <rect x="8" y="18" width="3" height="3"/>
    <rect x="16" y="18" width="3" height="3"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  minus: `<path d="M5 12h14"/>`,
  trash: `
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>
    <path d="M10 11v6M14 11v6"/>`,
  pix: `
    <path d="M12 3l9 9-9 9-9-9 9-9z"/>
    <path d="M8 12h8M12 8v8"/>`,
  cash: `
    <rect x="2" y="6" width="20" height="12"/>
    <rect x="6" y="10" width="12" height="4"/>
    <path d="M5 9v6M19 9v6"/>`,
  chart: `
    <path d="M4 20V4M4 20h17"/>
    <rect x="8" y="12" width="3" height="5"/>
    <rect x="13" y="8" width="3" height="9"/>
    <rect x="18" y="5" width="3" height="12"/>`,
  users: `
    <rect x="9" y="4" width="6" height="6"/>
    <path d="M5 20v-4a4 4 0 014-4h6a4 4 0 014 4v4"/>
    <path d="M3 10a3 3 0 003 3M21 10a3 3 0 01-3 3"/>`,
  box: `
    <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/>
    <path d="M3 7l9 5 9-5M12 12v10"/>`,
  flame: `
    <path d="M12 22c4 0 7-2.7 7-6.5 0-3-2-5.5-4-7.5-.5 2-1.6 3-2.6 3.4.2-3-1-5.6-3.4-8.4.3 4-4 6.5-4 12.5C5 19.3 8 22 12 22z"/>
    <path d="M12 22c1.7 0 3-1.3 3-3 0-1.3-1-2.4-3-4.5-2 2.1-3 3.2-3 4.5 0 1.7 1.3 3 3 3z"/>`,
  print: `
    <path d="M6 9V3h12v6"/>
    <rect x="3" y="9" width="18" height="8"/>
    <rect x="6" y="15" width="12" height="6"/>
    <rect x="17" y="12" width="2" height="2"/>`,
  check: `<path d="M4 12l5 5L20 6"/>`,
  x: `<path d="M5 5l14 14M19 5L5 19"/>`,
  arrowRight: `<path d="M4 12h15M13 6l6 6-6 6"/>`,
  arrowLeft: `<path d="M20 12H5M11 6l-6 6 6 6"/>`,
  logout: `
    <path d="M14 4H5v16h9"/>
    <path d="M10 12h11M17 8l4 4-4 4"/>`,
  key: `
    <rect x="3" y="10" width="9" height="6"/>
    <path d="M12 13h9M18 13v3M15 13v2"/>
    <rect x="6" y="12" width="2" height="2"/>`,
  download: `
    <path d="M12 3v12M7 10l5 5 5-5"/>
    <path d="M4 20h16"/>`,
  upload: `
    <path d="M12 17V5M7 10l5-5 5 5"/>
    <path d="M4 20h16"/>`,
  alert: `
    <path d="M12 3L2 21h20L12 3z"/>
    <path d="M12 9v5M12 17v1"/>`,
  clock: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 3"/>`,
  search: `
    <circle cx="10" cy="10" r="6"/>
    <path d="M15 15l6 6"/>`,
  refresh: `
    <path d="M20 12a8 8 0 11-2.3-5.7"/>
    <path d="M20 4v5h-5"/>`,
  shield: `
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>
    <path d="M8 12l3 3 5-6"/>`,
  star: `
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3z"/>`,
  receipt: `
    <path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3H5z"/>
    <path d="M8 7h8M8 11h8M8 15h5"/>`,
  copy: `
    <rect x="8" y="8" width="12" height="12"/>
    <path d="M16 8V4H4v12h4"/>`,
  edit: `
    <path d="M4 20h4L20 8l-4-4L4 16v4z"/>
    <path d="M14 6l4 4"/>`,
  home: `
    <path d="M3 12l9-8 9 8"/>
    <path d="M5 10v10h14V10M10 20v-6h4v6"/>`,
  info: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 10v6M12 7v1"/>`,
  phone: `
    <rect x="7" y="2" width="10" height="20"/>
    <path d="M10 5h4M11 18h2"/>`,
  wifi: `
    <path d="M3 9a15 15 0 0118 0M6 13a10 10 0 0112 0M9 17a5 5 0 016 0"/>
    <rect x="11" y="20" width="2" height="2"/>`,
};

export function icon(name, size = 18, className = '') {
  const path = PATHS[name] || PATHS.info;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${path}</svg>`;
}
