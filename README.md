# Rasec - Espetinhos

Sistema de cardápio, vendas, estoque e gestão da barraca **Rasec - Espetinhos** na Feira de Empreendedorismo do C.E.P.K.

O projeto é dividido em duas camadas no mesmo repositório, servidas pelo mesmo processo Node:

| Camada | Pasta | Documentação | Tecnologia |
|---|---|---|---|
| **Back-end** | `server/` | [`docs/BACKEND.md`](docs/BACKEND.md) | Node.js puro (`node:http`, `node:crypto`), banco JSON e API REST. |
| **Front-end** | `public/` | [`docs/FRONTEND.md`](docs/FRONTEND.md) | JavaScript vanilla com ES Modules, SPA por hash e PWA instalável. |

Sem dependências externas, sem build e sem bundler.

## Rodar

```bash
npm start        # http://localhost:3000
npm run dev      # reinicia automaticamente ao salvar
npm test         # testes da API e da persistência
npm run check:encoding  # procura textos com encoding quebrado
npm run fix:encoding    # corrige automaticamente os textos encontrados
npm run art      # regenera os SVGs do logo e dos espetinhos
npm run import:firebase  # importa um backup JSON para o Firebase
```

Requisito: **Node.js 20 ou superior**.

## Primeiro acesso

Ao criar o banco pela primeira vez, são cadastradas 7 contas:

`bruno`, `bruna`, `eduardo`, `julia`, `endrick`, `kaua`, `jhonathan`

- Senha inicial: `rasec123` (ou o valor de `SEED_PASSWORD`).
- O app pede a troca da senha no primeiro login.
- Código de convite para novos vendedores: `RASEC2026` (editável em **Equipe**).
- Contas criadas pelo convite entram como **vendedor**; as contas iniciais entram como **admin**.

## Estrutura

```
server/            back-end: HTTP, API, auth, banco JSON e arquivos estáticos
  index.js         bootstrap HTTP/HTTPS, headers e shutdown
  api.js           rotas e regras de negócio
  store.js         seed, migração, gravação atômica e sincronização
  firebase.js      cliente REST do Firebase Realtime Database
  auth.js          scrypt e tokens de sessão
  util.js          validação, cookies, datas, dinheiro e CSV
  static.js        entrega de public/ com ETag e anti-path-traversal
public/            front-end: SPA, views, CSS, assets, manifest e service worker
  index.html
  js/app.js        shell, rotas, polling e PWA
  js/views/        cardápio, carrinho, painel, pedidos, estoque, equipe e perfil
  css/app.css      design system pixel art
  manifest.webmanifest
  sw.js
data/              cache local (ignorado pelo git; opcional com Firebase)
  db.json
  db.backup.json
test/              testes da API e da persistência (local e Firebase falso)
tools/             geradores de arte, importador do Firebase, checagem de encoding e utilitário WPA
docs/              documentação de back-end, front-end e deploy no Render
```

## Back-end em resumo

- API em `/api/*` com autenticação por cookie `HttpOnly` e sessões de 7 dias.
- Senhas com `scrypt`; papéis `admin` e `vendedor`; rate limit de login.
- Pedidos com baixa de estoque, cancelamento com reposição e numeração `#001`.
- Estatísticas do dia, exportação CSV, backup JSON e reset de vendas.
- Persistência em `data/db.json` com escrita atômica (`tmp` + `rename`) e sincronização opcional com o Firebase.
- **Firebase opcional**: o banco inteiro é lido/gravado no Realtime Database, então deploys e restarts não apagam os dados.
- Headers de segurança, healthcheck em `GET /api/health` e logs de API.

Variáveis principais:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor. |
| `HOST` | `0.0.0.0` | Interface de escuta. |
| `DATA_DIR` | `./data` | Pasta do cache local e do backup. |
| `SEED_PASSWORD` | `rasec123` | Senha inicial usada só na criação do banco. |
| `COOKIE_SECURE` | desligado | `1` força o cookie como `Secure` (use atrás de HTTPS). |
| `FIREBASE_DATABASE_URL` | — | URL do Realtime Database; ativa a persistência externa. |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | — | JSON da conta de serviço em Base64 (recomendado no Render). |
| `FIREBASE_SERVICE_ACCOUNT` | — | JSON da conta de serviço em uma linha. |
| `FIREBASE_SERVICE_ACCOUNT_FILE` | — | Caminho do JSON da conta de serviço. |
| `FIREBASE_DB_PATH` | `rasec/db` | Nó do banco dentro do Realtime Database. |
| `TLS_CERT` / `TLS_KEY` | — | Sobem HTTPS direto no Node. |

Detalhes de rotas, modelo de dados, segurança e backup: [`docs/BACKEND.md`](docs/BACKEND.md).

## Front-end em resumo

- SPA com rotas por hash: `#/cardapio`, `#/carrinho`, `#/painel`, `#/pedidos`, `#/estoque`, `#/equipe` (admin) e `#/perfil`.
- Estado em memória, carrinho em `Map` e polling de 15 s no painel/pedidos/estoque.
- PWA com manifest, atalhos, service worker e app shell offline.
- Visual pixel art (GBA / Pokémon FireRed), fontes locais e layout responsivo.
- Sem framework e sem etapa de build: edite e recarregue.

O PWA **só é instalável em HTTPS** (ou `localhost`). Para testar no celular, use um túnel HTTPS:

```bash
cloudflared tunnel --url http://localhost:3000
# ou
ngrok http 3000
```

Detalhes de views, estado, cache e instalação: [`docs/FRONTEND.md`](docs/FRONTEND.md).

## Publicar fora do localhost

O servidor continua sendo **uma única instância**, porque o banco é um JSON e as gravações são serializadas. Vercel, Netlify e funções serverless não servem.

Para não perder dados em deploy/restart, use um **Firebase Realtime Database** como banco externo. O app grava o JSON inteiro no Firebase a cada alteração e usa o arquivo local apenas como cache/backup rápido.

- **Render (recomendado)**: o `render.yaml` já configura Node, HTTPS, healthcheck e as variáveis do Firebase. Com o banco externo, o plano **Free** pode ser usado (ele dorme após 15 min, mas os dados continuam no Firebase). Para a feira, prefira o plano pago para não ter a primeira requisição lenta.
- **VPS pequena + Caddy + systemd**: controle total e HTTPS automático; pode usar Firebase ou um `DATA_DIR` com disco persistente.
- **Só para teste**: túnel (Cloudflare/ngrok), porque a URL muda e depende do PC ligado.

Passo a passo do Firebase e do Render em [`docs/RENDER.md`](docs/RENDER.md).

Antes de publicar:

1. Criar o Realtime Database e a conta de serviço no Firebase.
2. Configurar `FIREBASE_DATABASE_URL` e `FIREBASE_SERVICE_ACCOUNT_BASE64` no Render.
3. Definir `SEED_PASSWORD` forte no primeiro boot.
4. Usar HTTPS e `COOKIE_SECURE=1`.
5. Configurar healthcheck em `/api/health` e restart automático.
6. Baixar um backup JSON pelo app depois da configuração.
7. Trocar senhas iniciais, o código de convite e revisar os admins.

Checklist completo em [`docs/BACKEND.md`](docs/BACKEND.md).

## Segurança

- Senhas com `scrypt` + salt; tokens de sessão aleatórios e guardados apenas como hash.
- Cookie `HttpOnly`, `SameSite=Lax` e `Secure` em HTTPS.
- Rate limit de login (8 tentativas por 5 minutos por IP + usuário).
- CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` e `Permissions-Policy`.
- Validação de entrada e autorização no servidor em todas as rotas protegidas.
- Para uso fora da rede local, coloque atrás de HTTPS e faça backup com frequência.

## Ferramenta WPA

`tools/wpa_tool.py` é um utilitário independente para auditoria de configuração WPA/WPA2/WPA3 (PMK, PTK, PMKID, força de passphrase e perfis exportados pelo `netsh`). Ele não faz parte do app da barraca e não é necessário para rodar o PWA.
