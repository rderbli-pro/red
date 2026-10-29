# Rasec - Espetinhos

Sistema de cardápio, vendas, estoque e gestão da barraca **Rasec - Espetinhos** na Feira de Empreendedorismo do C.E.P.K.

O app roda em Node.js puro (sem dependências externas), usa um banco JSON local e pode ser instalado no celular como PWA.

## Stack

- **Node.js 20+** (`node:http`, `node:crypto`, `node:test`).
- **Frontend** em JavaScript vanilla com ES Modules, SPA e rotas por hash.
- **Persistência** em `data/db.json`, com escrita atômica e backup.
- **PWA** com manifest, service worker e ícones para instalação no celular.
- **Visual** pixel art (GBA / Pokémon FireRed) com CSS próprio e SVGs gerados por código.

## Rodar

```bash
npm start        # inicia em http://localhost:3000
npm run dev      # reinicia automaticamente ao salvar
npm test         # roda os testes da API
npm run check:encoding  # procura textos com encoding quebrado
npm run fix:encoding    # corrige automaticamente os textos encontrados
npm run art      # regenera os SVGs do logo e dos espetinhos
```

Requisitos: Node.js 20 ou superior.

## Primeiro acesso

Ao criar o banco pela primeira vez, são cadastradas 7 contas de equipe:

`bruno`, `bruna`, `eduardo`, `julia`, `endrick`, `kaua`, `jhonathan`

- Senha inicial: `rasec123` (ou o valor de `SEED_PASSWORD`).
- O app pede a troca da senha no primeiro login.
- Código de convite para novos vendedores: `RASEC2026` (editável em **Equipe**).
- Contas criadas pelo convite entram como **vendedor**; as contas iniciais entram como **admin**.

## Instalar no celular (PWA)

O PWA **só pode ser instalado em HTTPS** (ou em `localhost` no computador). Em `http://192.168.x.x` o navegador não registra o service worker e o botão de instalação não aparece.

### Opção 1: túnel HTTPS (mais simples)

Com o servidor rodando em `localhost:3000`:

```bash
cloudflared tunnel --url http://localhost:3000
# ou
ngrok http 3000
```

Abra a URL `https://...` gerada no celular. Depois:

- **Android/Chrome:** menu ⋮ → **Instalar app** (ou o botão **INSTALAR APP** em Perfil).
- **iPhone/Safari:** botão Compartilhar → **Adicionar à Tela de Início**.

### Opção 2: HTTPS local com certificado

Gere um certificado para o IP do computador na rede (troque `192.168.0.10` pelo seu IP):

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=rasec.local" \
  -addext "subjectAltName=IP:192.168.0.10,DNS:localhost"
```

No Linux/macOS:

```bash
TLS_CERT=certs/cert.pem TLS_KEY=certs/key.pem COOKIE_SECURE=1 npm start
```

No PowerShell:

```powershell
$env:TLS_CERT="certs/cert.pem"; $env:TLS_KEY="certs/key.pem"; $env:COOKIE_SECURE="1"; npm start
```

Abra `https://192.168.0.10:3000` no celular. Como o certificado é autoassinado, o navegador vai avisar; aceite o aviso (ou instale a CA no aparelho) para liberar o service worker. Para evitar avisos, use `mkcert` para gerar um certificado confiável na sua rede.

> Durante testes, alguns navegadores permitem liberar uma origem HTTP em `chrome://flags/#unsafely-treat-insecure-origin-as-secure`. Isso não é recomendado para uso real.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor. |
| `HOST` | `0.0.0.0` | Interface de escuta (use `0.0.0.0` para acessar pela rede). |
| `DATA_DIR` | `./data` | Pasta do `db.json` e do backup. |
| `SEED_PASSWORD` | `rasec123` | Senha inicial usada só na criação do banco. |
| `COOKIE_SECURE` | desligado | `1` força o cookie de sessão como `Secure`. |
| `TLS_CERT` | — | Caminho do certificado PEM para habilitar HTTPS. |
| `TLS_KEY` | — | Caminho da chave PEM para habilitar HTTPS. |

## Estrutura

```
server/
  index.js      HTTP/HTTPS, headers de segurança e boot
  api.js        rotas da API (auth, produtos, pedidos, stats, equipe, admin)
  store.js      banco JSON, seed, migração e gravação atômica
  auth.js       scrypt, tokens de sessão e hash do token
  util.js       validação, cookies, datas, dinheiro e CSV
  static.js     arquivos estáticos, ETag e proteção contra path traversal
public/
  index.html    shell da SPA e tags do PWA
  manifest.webmanifest
  sw.js         service worker (app shell offline; API sempre na rede)
  css/app.css
  js/           estado, API, UI, ícones e views
  assets/       logo, espetinhos, fontes e ícones do PWA
data/
  db.json       banco em uso (ignorado pelo git)
  db.backup.json cópia do estado inicial
test/
  api.test.js   fluxo completo da API
tools/
  gen-art.mjs   gera os SVGs pixel art
  wpa_tool.py   utilitário separado de auditoria WPA/WPA2/WPA3
```

## API

| Método | Rota | Acesso |
|---|---|---|
| `GET` | `/api/health` | público |
| `POST` | `/api/auth/login` | público |
| `POST` | `/api/auth/register` | público (código de convite) |
| `POST` | `/api/auth/logout` | sessão |
| `GET` | `/api/auth/me` | sessão |
| `POST` | `/api/auth/password` | sessão |
| `GET` | `/api/products` | sessão |
| `PATCH` | `/api/products/:id` | admin |
| `GET` | `/api/orders` | sessão |
| `POST` | `/api/orders` | sessão |
| `PATCH` | `/api/orders/:id/status` | sessão |
| `GET` | `/api/orders/export.csv` | admin |
| `GET` | `/api/stats` | sessão |
| `GET` / `POST` / `PATCH` | `/api/users...` | admin |
| `GET` / `PATCH` | `/api/settings` | admin |
| `GET` | `/api/admin/backup` | admin |
| `POST` | `/api/admin/reset-orders` | admin |

Dinheiro é sempre tratado em **centavos** (inteiro) no servidor.

## Dados e backup

- O banco fica em `data/db.json`; o arquivo é gravado em um temporário e renomeado para evitar corrupção.
- `data/db.backup.json` guarda uma cópia do estado inicial.
- Em **Equipe** é possível baixar um backup JSON completo e exportar as vendas em CSV.
- **Zerar vendas** apaga os pedidos e reinicia a numeração em `#001`; o estoque atual não é reposto automaticamente.

## Segurança

- Senhas com `scrypt` + salt; tokens de sessão aleatórios e armazenados apenas como hash.
- Cookie `HttpOnly`, `SameSite=Lax` e `Secure` automaticamente em HTTPS.
- Rate limit de login (8 tentativas por 5 minutos por IP + usuário).
- CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` e `Permissions-Policy`.
- Validação de entrada e autorização no servidor em todas as rotas protegidas.
- Para uso fora da rede local, coloque atrás de HTTPS e faça backup com frequência.

## Ferramenta WPA

`tools/wpa_tool.py` é um utilitário independente para auditoria de configuração WPA/WPA2/WPA3 (PMK, PTK, PMKID, força de passphrase e perfis exportados pelo `netsh`). Ele não faz parte do app da barraca e não é necessário para rodar o PWA.
