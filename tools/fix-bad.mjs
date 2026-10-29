import fs from 'node:fs';
import path from 'node:path';

const TEXT_EXT = /\.(js|mjs|html|css|json|md)$/;
const ROOTS = ['public', 'server', 'test', 'tools'];

// Caracteres que o Windows-1252 mapeia fora do Latin-1 (0x80-0x9F).
const CP1252 = {
  '\u20ac': 0x80, '\u201a': 0x82, '\u0192': 0x83, '\u201e': 0x84,
  '\u2026': 0x85, '\u2020': 0x86, '\u2021': 0x87, '\u02c6': 0x88,
  '\u2030': 0x89, '\u0160': 0x8a, '\u2039': 0x8b, '\u0152': 0x8c,
  '\u017d': 0x8e, '\u2018': 0x91, '\u2019': 0x92, '\u201c': 0x93,
  '\u201d': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
  '\u02dc': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203a': 0x9b,
  '\u0153': 0x9c, '\u017e': 0x9e, '\u0178': 0x9f,
};

const MOJIBAKE =
  /(?:\u00c2|\u00c3)[\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]|\u00e2\u20ac[\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/g;

/** Converte a sequência mojibake de volta para o texto UTF-8 original. */
function repair(sequence) {
  const bytes = Uint8Array.from(
    [...sequence].map((char) => {
      const code = char.codePointAt(0);
      if (code <= 0xff) return code;
      return CP1252[char] ?? (code & 0xff);
    }),
  );
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return sequence;
  }
}

let changedFiles = 0;
let changedSequences = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!TEXT_EXT.test(entry.name)) continue;

    const text = fs.readFileSync(file, 'utf8');
    let count = 0;
    const fixed = text.replace(MOJIBAKE, (sequence) => {
      const next = repair(sequence);
      if (next !== sequence) count += 1;
      return next;
    });
    if (count) {
      fs.writeFileSync(file, fixed, 'utf8');
      changedFiles += 1;
      changedSequences += count;
      console.log(`${file}: ${count} sequência(s) corrigida(s)`);
    }
  }
}

for (const dir of ROOTS) walk(dir);

console.log(
  changedSequences
    ? `\n${changedSequences} sequência(s) corrigida(s) em ${changedFiles} arquivo(s).`
    : 'Nenhum encoding quebrado encontrado.',
);
