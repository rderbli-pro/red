import fs from 'node:fs';
import path from 'node:path';

const TEXT_EXT = /\.(js|mjs|html|css|json|md)$/;
const ROOTS = ['public', 'server', 'test', 'tools'];

// Sequências típicas de UTF-8 interpretado como Windows-1252/Latin-1.
const MOJIBAKE =
  /(?:\u00c2|\u00c3)[\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]|\u00e2\u20ac[\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/g;

let found = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!TEXT_EXT.test(entry.name)) continue;

    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const matches = line.match(MOJIBAKE);
      if (!matches) return;
      found += matches.length;
      console.log(`${file}:${index + 1} ${JSON.stringify(matches.slice(0, 6))}`);
    });
  }
}

for (const dir of ROOTS) walk(dir);

if (found) {
  console.error(`\n${found} sequência(s) de encoding quebrado encontrada(s).`);
  process.exitCode = 1;
} else {
  console.log('Encoding OK.');
}
