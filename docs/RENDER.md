# Deploy no Render

Guia para publicar o **Rasec - Espetinhos** no [Render](https://render.com) usando o `render.yaml` deste repositório.

O app é um servidor Node.js com banco JSON. Por isso o deploy precisa de **disco persistente** e **uma única instância**. O `render.yaml` já configura os dois.

## Por que não usar o plano Free

O plano Free do Render:

- **não aceita disco persistente** — o `db.json` é apagado a cada deploy, restart ou spin-down;
- **dorme após 15 minutos sem acesso** e leva ~1 minuto para acordar;
- pode reiniciar a qualquer momento.

Para vender na feira isso não serve: você perderia pedidos e estoque. Use o plano **Starter (`0.5c-512mb`)**.

| Item | Custo |
|---|---|
| Web service `0.5c-512mb` (0,5 CPU / 512 MB) | US$ 7,00/mês |
| Disco persistente de 1 GB | US$ 0,25/mês |
| **Total aproximado** | **US$ 7,25/mês** + impostos |

O workspace Hobby não tem mensalidade; você paga só o compute e o disco.

## O que o `render.yaml` configura

| Configuração | Valor |
|---|---|
| Runtime | Node.js `24.22.1` |
| Plano | `0.5c-512mb` (Starter) |
| Região | `virginia` (US East, mais perto do Brasil) |
| Build | `npm install` |
| Start | `npm start` |
| Healthcheck | `/api/health` |
| Disco | 1 GB montado em `/var/data` |
| `DATA_DIR` | `/var/data` |
| `COOKIE_SECURE` | `1` (HTTPS do Render) |
| `TZ` | `America/Sao_Paulo` (vendas do dia no horário de Brasília) |
| `SEED_PASSWORD` | solicitado no momento da criação (não fica no git) |
| Auto deploy | a cada push em `main` |

O Render injeta `PORT` automaticamente; o app já escuta em `0.0.0.0`.

## Passo a passo

### 1. Criar a conta

1. Acesse <https://dashboard.render.com/register>.
2. Entre com **GitHub** (conta `rderbli-pro`).
3. Autorize o Render a acessar o repositório `rderbli-pro/red` (o repo é público).

### 2. Criar o Blueprint

1. No painel, clique em **New → Blueprint**.
2. Selecione o repositório **`rderbli-pro/red`** e a branch **`main`**.
3. O Render lê o `render.yaml` e mostra o serviço `rasec-espetinhos`.
4. Quando pedir **`SEED_PASSWORD`**, informe uma senha forte e única (mínimo 6 caracteres). Ela será a senha inicial das 7 contas e **só é usada na primeira criação do banco**.
5. Clique em **Apply** / **Create Blueprint**.
6. Aguarde o build e o deploy. O log deve terminar com o banner da Rasec e `Listening`.

### 3. Descobrir a URL

O Render mostra a URL no topo do serviço, no formato:

```
https://rasec-espetinhos.onrender.com
```

Se o nome já estiver em uso, o Render pode gerar um sufixo. Use a URL exibida no painel.

Abra a URL, faça login com uma das contas (`bruno`, `bruna`, `eduardo`, `julia`, `endrick`, `kaua`, `jhonathan`) e a senha definida em `SEED_PASSWORD`.

### 4. Primeiro acesso (importante)

Depois do primeiro login:

1. Troque a senha das 7 contas (o app solicita no primeiro acesso).
2. Em **Equipe**, troque o código de convite `RASEC2026`.
3. Revise quem é **admin**; contas iniciais entram como admin.
4. Remova ou rebaixe contas que não serão usadas na feira.

## Disco e backup

- O banco fica em `/var/data/db.json`, dentro do disco persistente.
- O Render faz **snapshot automático diário** do disco e guarda por **7 dias**.
- Restaurar um snapshot volta o disco inteiro para aquele momento (perde tudo que veio depois).
- Além disso, use **Equipe → Backup** para baixar um JSON e **Exportar CSV** para as vendas.
- Para um backup fora do Render, baixe o JSON pelo app periodicamente ou use o Shell/SCP do serviço.

> O disco só pode ser usado por **uma instância**. Não escale o serviço para 2+ réplicas.

## Atualizações

Com `autoDeployTrigger: commit`, todo push em `main` dispara um deploy.

Como o serviço tem disco, o deploy **não é zero-downtime**: o Render para a instância antiga e sobe a nova, com alguns segundos de indisponibilidade. Evite publicar durante a feira.

## Domínio próprio (opcional)

1. No serviço, abra **Settings → Custom Domains**.
2. Adicione `rasec.seudominio.com` (ou o domínio que tiver).
3. No seu provedor de DNS, crie o `CNAME` indicado pelo Render.
4. O certificado TLS é emitido automaticamente.

Depois de trocar o domínio, o PWA deve ser reinstalado para apontar para a URL nova. O `COOKIE_SECURE=1` continua correto.

## Variáveis de ambiente

| Variável | Onde | Observação |
|---|---|---|
| `NODE_VERSION` | `render.yaml` | `24.22.1` |
| `TZ` | `render.yaml` | `America/Sao_Paulo` |
| `DATA_DIR` | `render.yaml` | `/var/data` (disco) |
| `COOKIE_SECURE` | `render.yaml` | `1` |
| `SEED_PASSWORD` | painel do Render | secreta, só no primeiro boot |
| `PORT` | Render | injetada automaticamente |

Para alterar uma variável depois: **Environment → Add Environment Variable** e salve (o serviço reinicia).

## Monitoramento

- **Healthcheck:** `GET /api/health` → `{ "ok": true }`.
- **Logs:** aba **Logs** do serviço.
- **Eventos:** aba **Events** (deploys, restarts e falhas).
- **Notificações:** configure e-mail no workspace para avisos de deploy/falha.

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `Application failed to respond` | app não escutou em `0.0.0.0:$PORT` | confira `startCommand` e logs; o app já usa `PORT`. |
| Dados zeraram após deploy | disco não montado ou `DATA_DIR` errado | confira o disco em `/var/data` e a env `DATA_DIR`. |
| Login não persiste | cookie `Secure` em HTTP | acesse sempre por `https://`; `COOKIE_SECURE=1` é obrigatório. |
| Serviço lento após inatividade | plano Free dormindo | use o plano pago `0.5c-512mb`. |
| Build falhou em `npm install` | versão do Node | confira `NODE_VERSION` e os logs. |
| “Hoje” com data errada | fuso UTC | mantenha `TZ=America/Sao_Paulo`. |

## Se quiser gastar zero

O Render Free não é indicado para vendas reais. Alternativas:

- manter local + túnel HTTPS (bom para teste, ruim para PWA de produção);
- VPS gratuita (Oracle Cloud Free Tier) com Caddy + systemd;
- outro host com volume persistente.

Para a feira, o custo de ~US$ 7,25/mês é o caminho mais simples e confiável.
