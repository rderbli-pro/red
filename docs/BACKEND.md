# Back-end — API Rasec

Documentação da camada de servidor do **Rasec - Espetinhos**. O front-end (SPA/PWA) está em [`docs/FRONTEND.md`](./FRONTEND.md).

O back-end é uma API HTTP em **Node.js puro**, sem dependências externas, que também serve os arquivos estáticos do front-end. Persiste tudo em um único JSON local e, opcionalmente, sincroniza esse JSON com o **Google Cloud Firestore** (API REST).

## Responsabilidades

- Autenticação por sessão (cookie), papéis `admin` e `vendedor`.
- CRUD de produtos/estoque e pedidos.
- Regras de negócio: baixa de estoque, cancelamento com reposição, numeração de pedidos, cálculo de troco.
- Estatísticas do dia e exportação CSV.
- Gestão da equipe, código de convite e backup/restauração.
- Headers de segurança, rate limit de login e gravação atômica do banco.

## Arquivos

| Arquivo | Papel |
|---|---|
| `server/index.js` | Bootstrap: cria o app HTTP/HTTPS, aplica headers, serve `/api/*` e o front-end, imprime endereços e trata `SIGINT`/`SIGTERM`. |
| `server/api.js` | Roteador e regras da API (auth, produtos, pedidos, stats, usuários, configurações, admin). |
| `server/store.js` | Seed, migração, escrita atômica, cache local e sincronização com o Firestore. |
| `server/firestore.js` | Cliente REST do Firestore, JWT da conta de serviço, codificação de valores e commit em lotes. |
| `server/auth.js` | Hash de senha com `scrypt`, geração/hash de token de sessão. |
| `server/util.js` | Erros HTTP, JSON, cookies, IP do cliente, validação, datas, dinheiro e CSV. |
| `server/static.js` | Entrega de `public/`, ETag, cache e proteção contra path traversal. |
| `test/api.test.js` | Testes de integração do fluxo completo. |

## Rodar

```bash
npm start   # http://localhost:3000
npm run dev # reinicia ao salvar
npm test    # testes da API
```

Requisito: **Node.js 20+**. Não há `npm install` obrigatório (zero dependências).

### Variáveis de ambiente

| Variável | Padrão | Efeito |
|---|---|---|
| `PORT` | `3000` | Porta HTTP/HTTPS. |
| `HOST` | `0.0.0.0` | Interface de escuta. |
| `DATA_DIR` | `./data` | Pasta do `db.json` e `db.backup.json` (cache local). |
| `SEED_PASSWORD` | `rasec123` | Senha inicial das 7 contas, usada **somente na criação** do banco. |
| `COOKIE_SECURE` | desligado | `1` marca o cookie de sessão como `Secure`. Obrigatório atrás de proxy HTTPS. |
| `FIRESTORE_ENABLED` | ligado | `false` desliga o Firestore mesmo com credencial. |
| `FIRESTORE_SERVICE_ACCOUNT_BASE64` | — | JSON da conta de serviço em Base64 (recomendado em produção). |
| `FIRESTORE_SERVICE_ACCOUNT` | — | JSON da conta de serviço em uma linha. |
| `FIRESTORE_SERVICE_ACCOUNT_FILE` | — | Caminho do JSON da conta de serviço. |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Alternativa ao arquivo acima. |
| `FIRESTORE_COLLECTION` | `rasec` | Coleção raiz no Firestore onde o banco é dividido em documentos. |
| `FIRESTORE_PROJECT` | do JSON | Project ID do Google Cloud (por padrão, o do `project_id` da credencial). |
| `TLS_CERT` | — | Certificado PEM; junto com `TLS_KEY`, sobe HTTPS direto no Node. |
| `TLS_KEY` | — | Chave PEM correspondente. |

## Fluxo de uma requisição

1. `server/index.js` aplica os headers de segurança em todas as respostas.
2. Se o caminho começa com `/api/`, chama `api()`; caso contrário, `serveStatic()`.
3. O roteador da API normaliza a URL, identifica o recurso e valida sessão/papel.
4. Erros são convertidos em JSON `{ error, code, fields? }` com o status adequado.
5. Requisições de API são logadas no console (exceto `GET` bem-sucedido e `/api/health`).

Headers aplicados: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` e `Permissions-Policy`. **HSTS não é enviado pela aplicação** — configure no proxy HTTPS.

## Modelo de dados (`data/db.json`)

```jsonc
{
  "version": 2,
  "createdAt": "2026-10-26T14:54:36.576Z",
  "users": [
    {
      "id": "uuid",
      "username": "bruno",
      "name": "Bruno",
      "role": "admin",            // "admin" | "vendedor"
      "salt": "hex",
      "passwordHash": "hex",      // scrypt, nunca a senha em texto
      "mustChangePassword": true,
      "createdAt": "iso",
      "lastLoginAt": "iso|null"
    }
  ],
  "products": [
    {
      "id": "carne",
      "name": "Espetinho de Carne",
      "shortName": "Carne",
      "description": "...",
      "price": 900,               // centavos
      "stock": 60,
      "available": true,
      "image": "/assets/espeto-carne.svg",
      "accent": "#a64b2a",
      "order": 1
    }
    // também: frango, coracao e misto
  ],
  "orders": [
    {
      "id": "uuid",
      "number": 1,                // exibido como #001
      "customer": "Cliente",
      "items": [
        {
          "productId": "carne",
          "name": "Carne",
          "fullName": "Espetinho de Carne",
          "price": 900,
          "qty": 2,
          "subtotal": 1800
        }
      ],
      "total": 1800,
      "payment": "pix",           // "pix" | "dinheiro"
      "cashGiven": null,          // só em dinheiro
      "change": null,             // só em dinheiro
      "status": "pendente",       // "pendente" | "preparando" | "entregue" | "cancelado"
      "createdAt": "iso",
      "updatedAt": "iso",
      "createdBy": { "id": "uuid", "name": "Bruno", "username": "bruno" },
      "statusHistory": [{ "status": "pendente", "at": "iso", "byName": "Bruno" }]
    }
  ],
  "sessions": [
    {
      "id": "uuid",
      "tokenHash": "sha256",      // o token original só existe no cookie
      "userId": "uuid",
      "createdAt": "iso",
      "expiresAt": "iso",         // 7 dias
      "userAgent": "..."
    }
  ],
  "settings": {
    "inviteCode": "RASEC2026",
    "shopName": "Rasec - Espetinhos",
    "fairName": "Feira de Empreendedorismo • C.E.P.K",
    "version": 2
  },
  "counters": { "nextOrderNumber": 1 }
}
```

Comportamentos do `store`:

- Sem `db.json` e sem Firestore, cria o banco com 7 contas, **4 sabores** (carne, frango, coração e misto) e configurações padrão.
- `migrate()` completa campos ausentes, converte o antigo sabor `linguica` em `coracao` (preservando preço/estoque), garante os 4 produtos e corrige o contador de pedidos.
- Grava em `db.json.tmp` e faz `rename` (atômico); se falhar, tenta gravação direta.
- `db.backup.json` é criado **apenas no primeiro seed** (estado inicial sem sessões).
- Sessões expiradas são removidas na carga e no acesso.
- Dinheiro é sempre inteiro em **centavos**.

### Firestore (banco externo)

- Ativado quando há uma credencial de conta de serviço: `FIRESTORE_SERVICE_ACCOUNT_BASE64`, `FIRESTORE_SERVICE_ACCOUNT`, `FIRESTORE_SERVICE_ACCOUNT_FILE`, `GOOGLE_APPLICATION_CREDENTIALS` ou, por fim, o arquivo `firestoreSecretKey.json` na raiz do projeto. `FIRESTORE_ENABLED=false` desliga mesmo com credencial.
- No boot, o app **lê o Firestore primeiro**; se a coleção não existir e houver `db.json` local, sobe esse banco. Se não houver nada, cria o seed e grava.
- Se o Firestore estiver configurado mas inacessível no boot, o processo **não inicia** — assim um deploy não sobrescreve dados bons com um banco vazio.
- Cada `store.save()` atualiza o cache local e enfileira a gravação do banco no Firestore. As rotas que alteram dados aguardam a gravação antes de responder.
- Falhas de rede no Firestore são registradas, o app continua atendendo e a gravação é repetida com backoff (5 s até 30 s).
- A coleção raiz padrão é `rasec`. O banco é dividido em documentos (`rasec/db` para meta, e `rasec/users/{id}`, `rasec/products/{id}`, `rasec/orders/{id}`, `rasec/sessions/{id}`), evitando o limite de 1 MiB por documento. Cada gravação é um `commit` em lotes de até 400 operações.
- O cache local em `DATA_DIR` continua sendo gravado, mas não é a fonte da verdade quando o Firestore está ativo.
- Sessões também vão para o Firestore; por isso os logins sobrevivem a deploy/restart.

## API

Prefixo: `/api`. Autenticação por cookie `rasec_sessao`.

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| `GET` | `/api/health` | público | Healthcheck `{ ok, app, version, storage, time }`. |
| `POST` | `/api/auth/login` | público | Login (`username`, `password`). |
| `POST` | `/api/auth/register` | público | Cadastro com `inviteCode`; cria `vendedor`. |
| `POST` | `/api/auth/logout` | sessão | Remove a sessão atual. |
| `GET` | `/api/auth/me` | sessão | Usuário, nome da barraca/feira e hora do servidor. |
| `POST` | `/api/auth/password` | sessão | Troca de senha; encerra as outras sessões. |
| `GET` | `/api/products` | sessão | Produtos com estoque e vendas. |
| `PATCH` | `/api/products/:id` | admin | Altera `price`, `stock` e/ou `available`. |
| `GET` | `/api/orders` | sessão | Lista pedidos (`status`, `mine`, `q`, `limit`). |
| `POST` | `/api/orders` | sessão | Cria pedido. |
| `PATCH` | `/api/orders/:id/status` | sessão | Muda status; cancelamento devolve estoque. |
| `GET` | `/api/orders/export.csv` | admin | Exporta vendas em CSV (`;`, BOM UTF-8). |
| `GET` | `/api/stats` | sessão | Estatísticas do dia, séries e alertas. |
| `GET` | `/api/users` | admin | Lista a equipe. |
| `POST` | `/api/users` | admin | Cria membro (`name`, `username`, `password`, `role`). |
| `PATCH` | `/api/users/:id` | admin | Altera nome, papel e/ou senha temporária. |
| `GET` | `/api/settings` | admin | Código de convite e nomes. |
| `PATCH` | `/api/settings` | admin | Altera `inviteCode` (4–24 caracteres `A-Z 0-9 -`). |
| `GET` | `/api/admin/backup` | admin | Download do banco completo (sessões anonimizadas). |
| `POST` | `/api/admin/reset-orders` | admin | Apaga pedidos; exige `{ "confirm": "APAGAR" }`. |

### Formato de erro

```json
{
  "error": "Mensagem para o usuário.",
  "code": "validation_error",
  "fields": { "password": "Mínimo de 6 caracteres." }
}
```

Códigos comuns: `invalid_credentials`, `rate_limited`, `forbidden`, `not_found`, `validation_error`, `username_taken`, `invalid_invite`, `insufficient_stock`, `price_changed`, `order_cancelled`, `last_admin`, `internal_error`.

### Login e sessão

- `POST /api/auth/login` valida usuário/senha e cria sessão de **7 dias**.
- Cookie `rasec_sessao`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=604800` e `Secure` quando `COOKIE_SECURE=1` ou TLS direto.
- O token (32 bytes aleatórios) não é gravado: o banco guarda apenas `sha256(token)`.
- Até 12 sessões ativas por usuário; as mais antigas são descartadas.
- Trocar a senha ou redefini-la por um admin encerra as sessões daquele usuário.
- Rate limit de login: **8 falhas por 5 minutos** por combinação IP + usuário (em memória, zera ao reiniciar).

### Pedidos

- `POST /api/orders` recebe `{ items: [{ productId, qty }], payment, customer?, cashGiven?, expectedTotal? }`.
- O servidor ignora preços enviados pelo cliente: recalcula tudo a partir do banco.
- Valida sabor existente, disponibilidade, estoque e limite de 50 unidades por item.
- Se `expectedTotal` vier e divergir do total atual, responde `409 price_changed`.
- Em dinheiro, `cashGiven` é obrigatório e precisa cobrir o total; o troco é calculado no servidor.
- `status` inicial é `pendente`; o número vem de `counters.nextOrderNumber` e é formatado como `#001`.
- `PATCH .../status` aceita `pendente`, `preparando`, `entregue`, `cancelado`.
- Pedido `cancelado` não pode ser alterado; ao cancelar, as quantidades voltam ao estoque.
- `GET /api/orders` aceita `status` (lista separada por vírgula), `mine=1`, `q` (número, cliente ou vendedor) e `limit` (1–500, padrão 200).

### Estatísticas

`GET /api/stats` retorna:

- `today`: faturamento, pedidos, itens, ticket médio, cancelados, pendentes e em preparo.
- `allTime`: faturamento e pedidos não cancelados.
- `byHour` (24 posições), `byFlavor`, `byPayment`, `bySeller`.
- `lowStock` (estoque ≤ 10) e `alerts` (senhas padrão, estoque baixo, pedidos pendentes).
- `recentOrders` (8 últimos) e `date` local.

## Segurança

- Senhas com `scrypt` (64 bytes), salt aleatório de 16 bytes e comparação `timingSafeEqual`.
- Login de usuário inexistente usa um hash fictício para não revelar quais contas existem.
- Sessões opacas, hash no banco e expiração de 7 dias.
- Validação de entrada e checagem de papel no servidor em todas as rotas protegidas.
- CSP restritiva, `frame-ancestors 'none'`, `nosniff`, `no-referrer` e permissões desativadas.
- Proteção contra path traversal em `static.js` (bloqueia `..` e arquivos ocultos).
- `readJson` limita o corpo a 1 MB.
- Regra do último administrador: não é possível remover o próprio admin nem deixar o sistema sem admin.

### Limitações conhecidas

- **Processo único**: o JSON e as escritas síncronas não suportam múltiplas réplicas/instâncias.
- `clientIp()` confia em `X-Forwarded-For` sem validação. Exposto direto na internet, um cliente pode forjar o header e driblar o rate limit. Em produção, use proxy confiável e restrinja o acesso direto à porta da aplicação.
- Rate limit fica em memória (reinicia com o processo).
- Sem HSTS na aplicação; configure no proxy (o Render já entrega tudo em HTTPS).

## Persistência e backup

- Sem Firestore: banco em `DATA_DIR/db.json`; use **disco persistente** em qualquer hospedagem.
- Com Firestore: o banco vive na coleção `rasec`; o `db.json` local é só cache. Não é necessário disco.
- Backup manual: **Equipe → Backup** (JSON) ou `GET /api/admin/backup`.
- Exportação de vendas: **CSV** (separador `;`, compatível com Excel pt-BR).
- **Zerar vendas** apaga os pedidos e reinicia em `#001`; **não** repõe estoque.
- O Firestore guarda versões dos dados no console do Google Cloud conforme o plano (PITR eExports automáticos).
- Migração de um backup JSON para o Firestore: `npm run import:firestore -- backup.json` (use `--force` só depois de baixar um backup).
- Para backup automático sem Firestore, copie `DATA_DIR` (ex.: cron + `rclone`/S3 ou snapshot do volume).
- Se o JSON local corromper e não houver Firestore, o processo não sobe: restaure um backup ou mova o arquivo para recomeçar.
- Se o Firestore estiver configurado e falhar no boot, o processo também não sobe — de propósito, para não iniciar vazio.

## Testes

```bash
npm test
```

Os testes sobem a aplicação com um `DATA_DIR` temporário e cobrem login, pedidos, estoque, cancelamento, permissões, CSV, backup, reset e a store com um backend Firestore falso.

## Checklist de produção (back-end)

1. Firestore (modo nativo) ativado no projeto e a API Firestore habilitada.
2. Conta de serviço gerada e configurada via `FIREBASE_SERVICE_ACCOUNT_BASE64` (ou arquivo).
3. `FIREBASE_DATABASE_URL` apontando para o banco correto.
4. `SEED_PASSWORD` forte definido **antes** do primeiro boot.
5. `COOKIE_SECURE=1` atrás de proxy HTTPS.
6. Proxy com HTTPS, HSTS e encaminhamento de `X-Forwarded-For`.
7. Healthcheck em `GET /api/health`; conferir `storage.mode = "firestore"`.
8. Backup JSON baixado pelo app depois de configurar.
9. Troca das senhas iniciais, do código de convite e revisão dos admins após o primeiro acesso.
10. Node.js 20+ com restart automático (systemd, Docker `restart: unless-stopped` etc.).
11. Uma única instância/réplica (o Firestore não muda essa regra).
