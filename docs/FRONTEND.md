# Front-end — SPA e PWA Rasec

Documentação da camada de interface do **Rasec - Espetinhos**. O back-end (API e persistência) está em [`docs/BACKEND.md`](./BACKEND.md).

O front-end é uma **SPA em JavaScript vanilla**, com ES Modules, **sem build, sem bundler e sem dependências**. É servido pelo próprio Node a partir de `public/`.

## Responsabilidades

- Cardápio, carrinho e criação de pedidos.
- Acompanhamento da cozinha, entrega e cancelamento.
- Painel de vendas do dia e estoque.
- Gestão da equipe (admin) e perfil do usuário.
- Instalação como PWA e abertura offline do app shell.
- Roteamento por hash, estado global e comunicação com a API.

## Arquivos

| Caminho | Papel |
|---|---|
| `public/index.html` | Shell da SPA, meta tags, fontes, manifest e boot. |
| `public/js/app.js` | Entrada: restaura sessão, monta shell/nav, rotas, polling, PWA e `boot()`. |
| `public/js/api.js` | Cliente `fetch` com `credentials: same-origin`, tratamento de erro e evento de sessão expirada. |
| `public/js/state.js` | Estado global: usuário, produtos, carrinho (`Map`), rota e filtros. |
| `public/js/ui.js` | Toasts, modais, confirmação, loading e botões ocupados. |
| `public/js/util.js` | Dinheiro, datas, números de pedido, escape de HTML e utilidades. |
| `public/js/icons.js` | Ícones SVG inline. |
| `public/js/views/` | Uma view por tela (ver tabela abaixo). |
| `public/css/app.css` | Design system pixel art, layout responsivo e estilos de impressão. |
| `public/manifest.webmanifest` | Metadados e atalhos do PWA. |
| `public/sw.js` | Service worker (app shell + estratégia de cache). |
| `public/assets/` | Logo, espetinhos em SVG, fontes WOFF2 e ícones PNG. |

## Rodar e depurar

O front-end não tem etapa de build: edite os arquivos e recarregue a página.

```bash
npm start   # ou npm run dev
```

- Abra `http://localhost:3000`.
- Para evitar cache durante o desenvolvimento, use **Ctrl+Shift+R** ou DevTools → Network → *Disable cache*.
- O service worker só é registrado em **HTTPS ou localhost**.
- Ao alterar arquivos do app shell, incremente `CACHE` em `public/sw.js` (ex.: `rasec-v2`) para forçar a atualização nos aparelhos.

## Rotas (hash router)

| Rota | View | Acesso | Conteúdo |
|---|---|---|---|
| `#/cardapio` | `views/menu.js` | sessão | Sabores, preço, estoque, disponibilidade e adição ao carrinho. |
| `#/carrinho` | `views/cart.js` | sessão | Quantidades, cliente, pagamento (Pix/dinheiro), valor recebido, troco e envio. |
| `#/painel` | `views/dashboard.js` | sessão | Vendas do dia, ticket médio, gráficos, alertas e últimos pedidos. |
| `#/pedidos` | `views/orders.js` | sessão | Filtros por status, busca, preparar/entregar/cancelar e comprovante. |
| `#/estoque` | `views/stock.js` | sessão (edição: admin) | Estoque, preço e disponibilidade dos sabores. |
| `#/equipe` | `views/team.js` | **admin** | Criar membro, promover/rebaixar, redefinir senha, convite, backup e reset. |
| `#/perfil` | `views/profile.js` | sessão | Dados da conta, troca de senha, instalar app e sair. |

Rota inválida cai em `#/cardapio`. Rota `adminOnly` tentada por vendedor mostra um toast e volta ao cardápio. O link direto funciona porque o servidor devolve `index.html` para caminhos sem extensão.

## Fluxo de boot

1. `app.js` chama `GET /api/auth/me`.
2. **200**: preenche `state.user`/`state.settings`, monta o shell e renderiza a rota.
3. **401**: mostra a tela de login (com cadastro por código de convite).
4. **Erro de rede**: mostra a tela “sem conexão” com botão de tentar novamente.
5. Se `mustChangePassword` for verdadeiro, abre um modal insistente para trocar a senha.
6. `hashchange` troca de view; a cada 15 s as telas de painel/pedidos/estoque se atualizam silenciosamente (pausa com aba oculta, modal aberto ou campo em foco).
7. O evento `rasec:unauthorized` (emitido pelo cliente de API em 401) encerra a sessão local e volta ao login.

## Estado e carrinho

`state.js` concentra o estado em memória (não há store externa):

- `user`, `settings`, `products`, `route`, `lastSync`.
- `cart`: `Map<productId, qty>`.
- `ui`: filtro de pedidos, busca e aviso do painel.

Regras do carrinho:

- Não adiciona item indisponível ou sem estoque.
- A quantidade é limitada ao estoque e a 50 por item.
- `setProducts()` revalida o carrinho quando o estoque muda (remove ou reduz itens).
- O carrinho **não é persistido** entre recarregamentos; ele vive só na sessão da página.
- `resetSession()` limpa usuário, produtos, carrinho, rota e filtros no logout.

## Cliente de API

`api.js` expõe `api.get/post/patch` e a classe `ApiError` (`message`, `status`, `code`, `fields`).

- Sempre envia `credentials: 'same-origin'` (cookie `HttpOnly`).
- Envia JSON apenas quando há corpo.
- Em `401`, dispara `window.dispatchEvent(new CustomEvent('rasec:unauthorized'))`, exceto no próprio login.
- Falha de rede vira mensagem amigável (“Sem conexão com o servidor…”).
- Erros de validação trazem `fields`, usados para marcar campos nos formulários.

Endpoints consumidos: `/api/auth/*`, `/api/products`, `/api/orders`, `/api/orders/export.csv`, `/api/stats`, `/api/users`, `/api/settings`, `/api/admin/*`. Contrato completo em [`BACKEND.md`](./BACKEND.md#api).

## Interface e design

- **Estilo**: pixel art inspirado em GBA / Pokémon FireRed.
- **Cores**: `--ink #141110`, `--cream #f2e6cc`, `--red #e01c1c`, `--gold #e2a63c`, `--green #4a8f53`.
- **Fontes**: `Press Start 2P` (títulos) e `VT323` (corpo), locais em WOFF2.
- **Componentes**: painéis com borda grossa, sombra dura, botões com estados `primary/ghost/danger`, barras de progresso e cards.
- **Layout**: navegação superior no desktop e tab bar fixa no mobile; grids fluidos; `@media print` para o comprovante.
- **Acessibilidade**: HTML semântico, `aria-live` nos toasts, `role="dialog"`/`aria-modal` nos modais, foco gerenciado, labels nos campos, contraste alto e `prefers-reduced-motion`.
- **Segurança de renderização**: conteúdo dinâmico passa por `escapeHtml`; a CSP não permite scripts inline.

## PWA

### Manifest

- Nome: **Rasec - Espetinhos** (`short_name: Rasec`), `display: standalone`.
- `start_url: /#/cardapio`, `scope: /`.
- Ícones 192/512 e máscara 512.
- Atalhos: Cardápio, Pedidos e Painel.

### Service worker (`public/sw.js`)

| Recurso | Estratégia |
|---|---|
| Navegação | Rede primeiro; se falhar, `index.html` do cache. |
| Estáticos (JS, CSS, fontes, ícones) | Cache primeiro, atualização em segundo plano. |
| `/api/*` | **Sempre rede**; nunca cacheia dados de venda, estoque ou sessão. |
| Outras origens | Ignoradas. |

- `install` pré-carrega o app shell e chama `skipWaiting()`.
- `activate` apaga caches antigos e chama `clients.claim()`.
- O registro usa `updateViaCache: 'none'` em `app.js`.
- O app shell offline permite abrir a interface sem internet; login e dados continuam exigindo o servidor.

### Instalação

Só funciona em **HTTPS** (ou `localhost`). Em `http://192.168.x.x` o navegador não registra o service worker.

- **Android/Chrome**: menu ⋮ → *Instalar app* (ou botão **INSTALAR APP** no Perfil).
- **iPhone/Safari**: Compartilhar → *Adicionar à Tela de Início*.
- O evento `beforeinstallprompt` é capturado e reutilizado pelo botão do Perfil; `appinstalled` mostra um toast.

Para testar no celular durante o desenvolvimento:

```bash
cloudflared tunnel --url http://localhost:3000
# ou
ngrok http 3000
```

Alternativa: certificado local para o IP da máquina (troque `192.168.0.10` pelo seu IP):

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem -out certs/cert.pem -days 365 \
  -subj "/CN=rasec.local" \
  -addext "subjectAltName=IP:192.168.0.10,DNS:localhost"

TLS_CERT=certs/cert.pem TLS_KEY=certs/key.pem COOKIE_SECURE=1 npm start
```

Como o certificado é autoassinado, o navegador avisa; aceite o aviso (ou instale a CA no aparelho) para liberar o service worker. `mkcert` gera um certificado confiável na rede local.

Em produção, use um domínio fixo com HTTPS — a URL do PWA precisa ser estável.

## Integração com o back-end

- O front-end **não calcula preço final**: envia itens e `expectedTotal`; o servidor recalcula e pode responder `price_changed`.
- O servidor é a fonte da verdade para estoque, disponibilidade, permissões e status.
- Dinheiro trafega em centavos; a formatação para `R$` é feita em `util.js`.
- O polling de 15 s mantém painel/pedidos/estoque próximos do tempo real sem WebSocket.
- Sessão expirada em qualquer chamada resulta em logout local automático.

## Checklist de testes manuais

1. Login com admin e com vendedor; conferir menus visíveis.
2. Montar pedido, testar Pix e dinheiro (com e sem troco).
3. Avançar status até entregue; cancelar um pedido e conferir a reposição do estoque.
4. Alterar preço/estoque como admin e ver o reflexo no cardápio.
5. Exportar CSV e baixar backup.
6. Instalar o PWA no Android e no iPhone; abrir offline e reconectar.
7. Testar em tela pequena, com teclado e com leitor de tela.
