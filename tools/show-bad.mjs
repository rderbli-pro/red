import fs from 'node:fs';
const text = fs.readFileSync('public/js/views/menu.js', 'utf8');
text.split(/\r?\n/).forEach((line, index) => {
  if (/[\u00C2\u00C3][\u0080-\u00BF]/.test(line)) console.log(index + 1, JSON.stringify(line));
});
