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
npm test         # testes da API (22 testes)
npm run check:encoding  # procura textos com encoding quebrado
npm run fix:encoding    # corrige automaticamente os textos encontrados
npm run art      # regenera os SVGs do logo e dos espetinhos
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
  store.js         seed, migração e gravação atômica
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
data/              banco em uso (ignorado pelo git)
  db.json
  db.backup.json
test/              testes de integração da API
tools/             geradores de arte, checagem de encoding e utilitário WPA
docs/              documentação de back-end, front-end e deploy no Render
```

## Back-end em resumo

- API em `/api/*` com autenticação por cookie `HttpOnly` e sessões de 7 dias.
- Senhas com `scrypt`; papéis `admin` e `vendedor`; rate limit de login.
- Pedidos com baixa de estoque, cancelamento com reposição e numeração `#001`.
- Estatísticas do dia, exportação CSV, backup JSON e reset de vendas.
- Persistência em `data/db.json` com escrita atômica (`tmp` + `rename`).
- Headers de segurança, healthcheck em `GET /api/health` e logs de API.

Variáveis principais:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor. |
| `HOST` | `0.0.0.0` | Interface de escuta. |
| `DATA_DIR` | `./data` | Pasta do banco e do backup. |
| `SEED_PASSWORD` | `rasec123` | Senha inicial usada só na criação do banco. |
| `COOKIE_SECURE` | desligado | `1` força o cookie como `Secure` (use atrás de HTTPS). |
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

A arquitetura pede **disco persistente** e **uma única instância** (o banco é um JSON com escrita síncrona). Vercel, Netlify e funções serverless não servem.

- **Render (mais simples)**: o `render.yaml` já configura Node, HTTPS, disco de 1 GB e healthcheck. Custa cerca de **US$ 7,25/mês** (Starter + disco). Passo a passo em [`docs/RENDER.md`](docs/RENDER.md).
- **VPS pequena + Caddy + systemd**: controle total e HTTPS automático, com backup diário do `DATA_DIR`.
- **Só para teste**: túnel (Cloudflare/ngrok), porque a URL muda e depende do PC ligado.

> **Não use o plano Free do Render**: ele não aceita disco, dorme após 15 minutos e apaga o `db.json` a cada restart. Para vendas reais, use o plano pago com disco.

Antes de publicar:

1. Definir `SEED_PASSWORD` forte no primeiro boot.
2. Montar disco persistente em `DATA_DIR`.
3. Usar HTTPS e `COOKIE_SECURE=1`.
4. Configurar healthcheck em `/api/health` e restart automático.
5. Agendar backup do `DATA_DIR`.
6. Trocar senhas iniciais, o código de convite e revisar os admins.
7. Remover `public/__preview.html`.

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
