/**
 * Gera os SVGs de arte pixel da Rasec.
 * Uso: node tools/gen-art.mjs
 *
 * Tudo é desenhado em grades inteiras (shape-rendering="crispEdges")
 * para manter o visual de pixel art do GBA.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'assets');
mkdirSync(outDir, { recursive: true });

const K = '#141110'; // tinta / contorno
const C = '#f2e6cc'; // creme do pôster
const C2 = '#e4d3b4'; // creme sombreado
const W = '#fff8e7'; // creme claro
const SK = '#f2e3c6'; // pele
const SK2 = '#dcc39c'; // pele sombreada
const R = '#e01c1c'; // vermelho do pôster
const R2 = '#8e1111'; // vermelho escuro
const M = '#a64b2a'; // carne
const ML = '#cf7a45';
const MD = '#6b2a17';

const rect = (x, y, w, h, fill) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">\n${body}\n</svg>\n`;

/* ------------------------------------------------------------------ */
/* Logo: rosto do Rasec (barba, óculos, bigode e espetinho no canto)   */
/* ------------------------------------------------------------------ */

function logo() {
  const p = [];
  // fundo
  p.push(rect(0, 0, 48, 48, C));
  // textura sutil: pontos creme escuro
  for (const [x, y] of [[8, 7], [40, 9], [7, 34], [41, 33], [24, 45], [9, 43], [39, 44]]) {
    p.push(rect(x, y, 1, 1, C2));
  }
  // ombros / camisa
  p.push(rect(7, 42, 34, 6, K));
  p.push(rect(9, 40, 30, 3, K));
  // pescoço
  p.push(rect(20, 36, 8, 7, SK));
  p.push(rect(20, 36, 8, 2, SK2));
  // orelhas
  p.push(rect(10, 19, 3, 6, SK));
  p.push(rect(35, 19, 3, 6, SK));
  p.push(rect(10, 19, 1, 2, K));
  p.push(rect(37, 19, 1, 2, K));
  // rosto
  p.push(rect(13, 10, 22, 20, SK));
  p.push(rect(13, 10, 2, 20, SK2));
  // cabelo
  p.push(rect(17, 5, 14, 2, K));
  p.push(rect(15, 7, 18, 2, K));
  p.push(rect(13, 9, 22, 3, K));
  p.push(rect(11, 12, 3, 11, K));
  p.push(rect(34, 12, 3, 11, K));
  p.push(rect(12, 23, 2, 4, K));
  p.push(rect(34, 23, 2, 4, K));
  // sobrancelhas
  p.push(rect(15, 15, 6, 2, K));
  p.push(rect(27, 15, 6, 2, K));
  // óculos: aro esquerdo
  p.push(rect(14, 17, 8, 1, K));
  p.push(rect(14, 21, 8, 1, K));
  p.push(rect(14, 17, 1, 5, K));
  p.push(rect(21, 17, 1, 5, K));
  p.push(rect(15, 18, 6, 3, W));
  // óculos: aro direito
  p.push(rect(26, 17, 8, 1, K));
  p.push(rect(26, 21, 8, 1, K));
  p.push(rect(26, 17, 1, 5, K));
  p.push(rect(33, 17, 1, 5, K));
  p.push(rect(27, 18, 6, 3, W));
  // ponte
  p.push(rect(22, 18, 4, 2, K));
  // pupilas
  p.push(rect(17, 18, 2, 2, K));
  p.push(rect(30, 18, 2, 2, K));
  // brilho das lentes
  p.push(rect(15, 18, 1, 1, W));
  p.push(rect(27, 18, 1, 1, W));
  // nariz
  p.push(rect(23, 22, 2, 3, SK2));
  p.push(rect(22, 24, 1, 1, K));
  p.push(rect(25, 24, 1, 1, K));
  // barba: laterais + queixo
  p.push(rect(10, 26, 6, 11, K));
  p.push(rect(32, 26, 6, 11, K));
  p.push(rect(13, 30, 22, 6, K));
  p.push(rect(12, 36, 24, 2, K));
  p.push(rect(14, 38, 20, 2, K));
  p.push(rect(17, 40, 14, 1, K));
  // bigode (largo, integrado à barba)
  p.push(rect(16, 25, 16, 4, K));
  p.push(rect(14, 26, 2, 4, K));
  p.push(rect(32, 26, 2, 4, K));
  p.push(rect(18, 29, 12, 1, K));
  // fio de luz na barba
  p.push(rect(14, 28, 1, 2, '#2b2622'));
  p.push(rect(33, 28, 1, 2, '#2b2622'));
  // moldura dupla
  p.push(rect(0, 0, 48, 2, K));
  p.push(rect(0, 46, 48, 2, K));
  p.push(rect(0, 0, 2, 48, K));
  p.push(rect(46, 0, 2, 48, K));
  p.push(rect(4, 4, 40, 1, K));
  p.push(rect(4, 43, 40, 1, K));
  p.push(rect(4, 4, 1, 40, K));
  p.push(rect(43, 4, 1, 40, K));
  // cantos vermelhos
  p.push(rect(2, 2, 5, 1, R));
  p.push(rect(41, 2, 5, 1, R));
  p.push(rect(2, 45, 5, 1, R));
  p.push(rect(41, 45, 5, 1, R));
  p.push(rect(2, 2, 1, 5, R));
  p.push(rect(45, 2, 1, 5, R));
  p.push(rect(2, 41, 1, 5, R));
  p.push(rect(45, 41, 1, 5, R));

  return svg(48, 48, p.join('\n'));
}

/* ------------------------------------------------------------------ */
/* Espetinhos                                                          */
/* ------------------------------------------------------------------ */

const flavors = {
  carne: { base: '#9c4326', light: '#d17c46', dark: '#5f2413', char: '#2c150c' },
  frango: { base: '#cf9140', light: '#f2c777', dark: '#8d5a1c', char: '#4a2d10' },
  linguica: { base: '#b23c2b', light: '#e0724e', dark: '#6d1d12', char: '#2f0d09' },
};

function chunk(p, x, y, w, h, f) {
  // contorno pixelado
  p.push(rect(x + 1, y, w - 2, h, K));
  p.push(rect(x, y + 1, w, h - 2, K));
  // corpo
  p.push(rect(x + 1, y + 1, w - 2, h - 2, f.base));
  p.push(rect(x + 1, y + 1, w - 2, 2, f.light));
  p.push(rect(x + 1, y + h - 3, w - 2, 2, f.dark));
  p.push(rect(x + 1, y + 1, 2, h - 2, f.light));
  // marcas de grelha
  p.push(rect(x + 4, y + 3, 1, 1, f.char));
  p.push(rect(x + 5, y + 4, 1, 1, f.char));
  p.push(rect(x + w - 6, y + 3, 1, 1, f.char));
  p.push(rect(x + w - 5, y + 4, 1, 1, f.char));
  p.push(rect(x + 5, y + h - 5, 1, 1, f.dark));
  p.push(rect(x + w - 7, y + h - 6, 1, 1, f.dark));
  // brilho
  p.push(rect(x + 3, y + 2, 2, 1, f.light));
  p.push(rect(x + w - 5, y + 2, 2, 1, f.light));
}

function espeto(f) {
  const p = [];
  // palito
  p.push(rect(14, 2, 4, 54, K));
  p.push(rect(15, 3, 2, 52, '#e8d5ae'));
  p.push(rect(15, 3, 1, 52, '#c7ab7c'));
  // ponta
  p.push(rect(15, 0, 2, 2, '#e8d5ae'));
  p.push(rect(16, 1, 1, 1, K));
  // pedaços
  const ys = [5, 16, 27, 38, 48];
  for (const y of ys) {
    chunk(p, 5, y, 22, 10, f);
  }
  return svg(32, 58, p.join('\n'));
}

/* ------------------------------------------------------------------ */

const files = {
  'logo-rasec.svg': logo(),
  'espeto-carne.svg': espeto(flavors.carne),
  'espeto-frango.svg': espeto(flavors.frango),
  'espeto-linguica.svg': espeto(flavors.linguica),
};

for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(outDir, name), content, 'utf8');
  console.log('gerado:', name);
}
