/**
 * Importa um backup JSON do Rasec para o Firestore.
 *
 * Uso:
 *   node tools/import-firestore.mjs backup-rasec-2026-11-10.json
 *   node tools/import-firestore.mjs backup.json --force
 *
 * Variáveis de ambiente (as mesmas do servidor):
 *   FIRESTORE_SERVICE_ACCOUNT_FILE  (ou FIRESTORE_SERVICE_ACCOUNT_BASE64)
 *   FIRESTORE_COLLECTION            coleção raiz (padrão: rasec)
 *
 * Sem nenhuma variável, usa automaticamente `firestoreSecretKey.json`
 * na raiz do projeto.
 *
 * Sem `--force`, o script se recusa a sobrescrever uma coleção que já tenha dados.
 */
import fs from 'node:fs';
import { createFirestoreBackend } from '../server/firestore.js';

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
const force = args.includes('--force');

if (!file) {
  console.error('Uso: node tools/import-firestore.mjs <backup.json> [--force]');
  process.exit(1);
}

let backend;
try {
  backend = createFirestoreBackend();
} catch (error) {
  console.error(`[import] ${error.message}`);
  process.exit(1);
}

if (!backend.enabled) {
  console.error(
    '[import] Nenhuma credencial encontrada. Defina FIRESTORE_SERVICE_ACCOUNT_BASE64, ' +
      'FIRESTORE_SERVICE_ACCOUNT_FILE ou crie o arquivo firestoreSecretKey.json na raiz.',
  );
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`[import] Não foi possível ler ${file}: ${error.message}`);
  process.exit(1);
}

const database = payload?.database ?? payload;
if (
  !database ||
  typeof database !== 'object' ||
  !Array.isArray(database.users) ||
  !Array.isArray(database.products)
) {
  console.error('[import] O arquivo não parece um backup do Rasec (users/products ausentes).');
  process.exit(1);
}

const existing = await backend.load().catch((error) => {
  console.error(`[import] Falha ao consultar o Firestore: ${error.message}`);
  process.exit(1);
});

if (existing && !force) {
  console.error(
    '[import] A coleção do Firestore já tem dados. Use --force para sobrescrever ' +
      '(faça um backup antes).',
  );
  process.exit(1);
}

// O backup do app não guarda os tokens de sessão, então começamos sem sessões.
database.sessions = [];

await backend.save(database).catch((error) => {
  console.error(`[import] Falha ao gravar no Firestore: ${error.message}`);
  process.exit(1);
});

console.log(
  `[import] OK: ${database.users.length} usuários, ${database.products.length} produtos, ` +
    `${database.orders?.length || 0} pedidos na coleção "${backend.root}" (projeto ${backend.project}).`,
);
