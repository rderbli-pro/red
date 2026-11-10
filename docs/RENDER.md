# Deploy no Render

Guia para publicar o **Rasec - Espetinhos** no [Render](https://render.com) usando o `render.yaml` deste repositório.

O app é um servidor Node.js com banco JSON. Para não perder vendas em deploy, restart ou spin-down, a configuração recomendada usa o **Google Cloud Firestore** como banco externo. O `render.yaml` já está preparado para esse modo.

## Dois modos de persistência

| Modo | Precisa de disco? | Sobrevive a deploy/restart? | Indicado para |
|---|---|---|---|
| **Firestore** (recomendado) | Não | Sim | Plano Free do Render e produção |
| **Disco persistente** | Sim (1 GB) | Sim | Quem prefere manter tudo no Render |

> O app continua sendo **uma única instância**. O Firestore resolve a durabilidade, mas não permite escalar para várias réplicas ao mesmo tempo.

## Custos

| Item | Custo |
|---|---|
| Web service Free | US$ 0 |
| Web service `0.5c-512mb` (Starter, sem dormir) | US$ 7,00/mês |
| Disco de 1 GB (só no modo disco) | US$ 0,25/mês |

No plano Free o serviço **dorme após 15 minutos sem acesso** e leva cerca de 1 minuto para acordar. Os dados continuam no Firestore; só a primeira requisição é lenta. Para vender na feira, o plano pago evita essa espera.

O `render.yaml` vem com `plan: free`. Para usar o plano pago, troque para `plan: 0.5c-512mb` (e, se quiser disco, adicione o bloco `disk`).

## Configuração do Firestore

O app usa o **Firestore em modo nativo** (não o Realtime Database), acessado pela API REST com a mesma conta de serviço.

### 1. Criar o projeto

1. Acesse <https://console.firebase.google.com>.
2. Clique em **Criar projeto** e dê um nome (ex.: `rasec-espetinhos`).
3. Pode desativar o Google Analytics; não é necessário.

### 2. Ativar o Firestore

1. No menu lateral, abra **Build → Firestore Database**.
2. Clique em **Criar banco de dados**.
3. Escolha **Firestore nativo** (não o modo Datastore nem o Realtime Database) e a região mais próxima (ex.: `us-central1`).
4. Comece em "modo de produção" (acesso fechado).
5. A coleção usada pelo app é `rasec` (variável `FIRESTORE_COLLECTION`).

Como o servidor usa uma conta de serviço, ele tem acesso administrativo e ignora as regras; portanto, mantenha-as fechadas para o público.
```

> Não use as regras públicas (`true`) neste app: o banco contém hashes de senhas, pedidos e sessões.

### 3. Gerar a conta de serviço

1. Clique na engrenagem → **Configurações do projeto**.
2. Abra a aba **Contas de serviço**.
3. Clique em **Gerar nova chave privada** e confirme.
4. Um arquivo JSON será baixado. **Não comite esse arquivo.**

O Render aceita a credencial em Base64, que é mais fácil de colar em uma variável de ambiente.

**Linux/macOS:**

```bash
base64 -w0 serviceAccount.json
# macOS:
base64 -i serviceAccount.json
```

**Windows (PowerShell):**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\serviceAccount.json")) | Set-Clipboard
```

O valor copiado vai em `FIRESTORE_SERVICE_ACCOUNT_BASE64`.

Alternativas suportadas: `FIRESTORE_SERVICE_ACCOUNT` (JSON em uma linha) ou `FIRESTORE_SERVICE_ACCOUNT_FILE` (caminho de um arquivo, útil em VPS/Docker). No seu computador, também basta salvar o JSON como `firestoreSecretKey.json` na raiz do projeto: o app o detecta automaticamente.

### 4. Migrar dados que já existem

Se a barraca já tem vendas no Render (disco) ou em `data/db.json`, faça a migração **antes** de remover o disco:

1. No app atual, abra **Equipe → Backup** e baixe o JSON. Se não conseguir, copie `data/db.json`.
2. No seu computador, salve a chave como `firestoreSecretKey.json` na raiz do projeto e rode:

   ```bash
   node tools/import-firestore.mjs backup-rasec-2026-11-10.json
   ```

   Ou, sem arquivo na raiz, com variáveis de ambiente:

   ```bash
   export FIRESTORE_SERVICE_ACCOUNT_FILE="./serviceAccount.json"
   node tools/import-firestore.mjs backup-rasec-2026-11-10.json
   ```

   No Windows (PowerShell):

   ```powershell
   $env:FIRESTORE_SERVICE_ACCOUNT_FILE="C:\caminho\serviceAccount.json"
   node tools/import-firestore.mjs backup-rasec-2026-11-10.json
   ```

3. Confira no console do Firebase, em **Firestore Database → Dados**, se a coleção `rasec` tem usuários, produtos e pedidos.
4. Só então faça o deploy no Render sem disco.

> O script se recusa a sobrescrever uma coleção que já tenha dados. Se tiver certeza, use `--force` (e baixe um backup antes).
>
> Alternativa: mantenha o disco no **primeiro** deploy com Firestore. Como a coleção remota ainda estará vazia, o app sobe o `db.json` local automaticamente. Não remova o disco no mesmo deploy em que ativa o Firestore.

## O que o `render.yaml` configura

| Configuração | Valor |
|---|---|
| Runtime | Node.js `24.22.1` |
| Plano | `free` (troque para `0.5c-512mb` na feira) |
| Região | `virginia` (US East, mais perto do Brasil) |
| Build | `npm install` |
| Start | `npm start` |
| Healthcheck | `/api/health` |
| `TZ` | `America/Sao_Paulo` (vendas do dia no horário de Brasília) |
| `COOKIE_SECURE` | `1` (HTTPS do Render) |
| `FIREBASE_DB_PATH` | `rasec/db` (nó onde o banco é gravado) |
| `SEED_PASSWORD` | solicitado no momento da criação (não fica no git) |
| `FIREBASE_DATABASE_URL` | solicitado no momento da criação |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | solicitado no momento da criação |
| Auto deploy | a cada push em `main` |

O Render injeta `PORT` automaticamente; o app já escuta em `0.0.0.0`.

## Passo a passo no Render

### 1. Criar a conta

1. Acesse <https://dashboard.render.com/register>.
2. Entre com **GitHub** (conta `rderbli-pro`).
3. Autorize o Render a acessar o repositório `rderbli-pro/red` (o repo é público).

### 2. Criar o Blueprint

1. No painel, clique em **New → Blueprint**.
2. Selecione o repositório **`rderbli-pro/red`** e a branch **`main`**.
3. O Render lê o `render.yaml` e mostra o serviço `rasec-espetinhos`.
4. Quando pedir as variáveis secretas, informe:
   - **`SEED_PASSWORD`**: uma senha forte e única (mínimo 6 caracteres). Ela será a senha inicial das 7 contas e **só é usada na primeira criação do banco**.
   - **`FIRESTORE_SERVICE_ACCOUNT_BASE64`**: o JSON da conta de serviço em Base64.
5. Clique em **Apply** / **Create Blueprint**.
6. Aguarde o build e o deploy. O log deve mostrar o banner da Rasec e uma linha parecida com:
   `Dados: Firestore (coleção "rasec" • projeto SEU-PROJETO) + cache local`

### 3. Confirmar que o banco externo está ativo

Abra:

```
https://SUA-URL.onrender.com/api/health
```

A resposta deve conter:

```json
{
  "ok": true,
  "storage": {
    "mode": "firestore",
    "ok": true,
    "pending": false
  }
}
```

Também é possível conferir no console do Firebase, em **Firestore Database → Dados**, a coleção `rasec` com os usuários, produtos e pedidos.

### 4. Primeiro acesso

Depois do primeiro login:

1. Troque a senha das 7 contas (o app solicita no primeiro acesso).
2. Em **Equipe**, troque o código de convite `RASEC2026`.
3. Revise quem é **admin**; contas iniciais entram como admin.
4. Remova ou rebaixe contas que não serão usadas na feira.
5. Baixe um backup JSON em **Equipe → Backup**.

## Backup

- O banco principal está no Firestore, na coleção `rasec`.
- O Firestore mantém backups/versionamento no console do Google Cloud conforme o plano (PITR).
- **Equipe → Backup** baixa o JSON completo pelo próprio app.
- **Exportar CSV** baixa as vendas para Excel/Sheets.
- O cache local em `data/db.json` (efêmero no Render Free) serve apenas para leitura rápida e diagnóstico.

## Atualizações

Com `autoDeployTrigger: commit`, todo push em `main` dispara um deploy.

- Com Firestore, o deploy pode apagar o disco local sem problema: o app lê tudo do Firestore ao subir.
- O Render ainda para a instância antiga antes de subir a nova (alguns segundos de indisponibilidade). Evite publicar durante a feira.
- O plano Free também reinicia/spin-down com frequência; os dados permanecem no Firestore.

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
| `COOKIE_SECURE` | `render.yaml` | `1` |
| `FIREBASE_DB_PATH` | `render.yaml` | `rasec/db` |
| `SEED_PASSWORD` | painel do Render | secreta, só no primeiro boot |
| `FIRESTORE_COLLECTION` | `render.yaml` | Coleção raiz no Firestore (`rasec`) |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | painel do Render | conta de serviço em Base64 |
| `DATA_DIR` | opcional | pasta do cache local (padrão `./data`) |
| `PORT` | Render | injetada automaticamente |

Para alterar uma variável depois: **Environment → Add Environment Variable** e salve (o serviço reinicia).

## Segurança

- Nunca comite o JSON da conta de serviço nem o valor de `FIREBASE_SERVICE_ACCOUNT_BASE64`.
- Se a chave vazar, revogue-a no Google Cloud IAM e gere outra.
- Mantenha as regras do Firestore fechadas.
- Use `COOKIE_SECURE=1` e acesse sempre por `https://`.
- O healthcheck expõe apenas o modo de armazenamento e se há erro pendente, não a credencial.

## Monitoramento

- **Healthcheck:** `GET /api/health` → `{ "ok": true }` e o bloco `storage`.
- **Logs:** aba **Logs** do serviço. Falhas de gravação no Firestore aparecem como `[rasec] falha ao gravar no Firestore: ...`.
- **Eventos:** aba **Events** (deploys, restarts e falhas).
- **Notificações:** configure e-mail no workspace para avisos de deploy/falha.

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `Application failed to respond` | app não escutou em `0.0.0.0:$PORT` | confira `startCommand` e logs; o app já usa `PORT`. |
| App não inicia: “Não foi possível carregar o banco do Firestore” | credencial expirada/errada ou internet indisponível no boot | confira a credencial, se o Firestore nativo está ativado e os logs. |
| `storage.mode` é `local` no healthcheck | variáveis do Firestore ausentes | defina `FIRESTORE_SERVICE_ACCOUNT_BASE64` (ou outro formato de credencial) e faça novo deploy. |
| Dados zeraram após deploy | Firestore não configurado, ou `FIRESTORE_COLLECTION` mudou | confira a coleção no console do Firestore; mantenha a mesma coleção. |
| Login não persiste | cookie `Secure` em HTTP | acesse sempre por `https://`; `COOKIE_SECURE=1` é obrigatório. |
| Serviço lento após inatividade | plano Free dormindo | use o plano pago `0.5c-512mb` na feira. |
| “Google recusou a conta de serviço (403)” | chave revogada, projeto errado ou API desativada | gere outra chave e confira o projeto do banco. |
| Permissão negada no Firestore | credencial trocada ou API desativada | o servidor usa conta de serviço; confira se o JSON é do mesmo projeto e se a API Firestore está habilitada. |
| Build falhou em `npm install` | versão do Node | confira `NODE_VERSION` e os logs. |
| “Hoje” com data errada | fuso UTC | mantenha `TZ=America/Sao_Paulo`. |

## Usar disco persistente em vez do Firestore

Se preferir não usar Firestore:

1. No `render.yaml`, troque `plan: free` por `plan: 0.5c-512mb`.
2. Remova as variáveis `FIREBASE_*` e adicione:
   ```yaml
   - key: DATA_DIR
     value: /var/data
   disk:
     name: rasec-data
     mountPath: /var/data
     sizeGB: 1
   ```
3. Faça o deploy.

Nesse modo, o `db.json` fica no disco do Render e o backup depende de snapshots do disco ou downloads manuais.

## Se quiser gastar zero

Com Firestore, o plano Free do Render serve para testes e para a feira com pouco movimento, aceitando o spin-down de 15 minutos. Alternativas:

- plano pago do Render com Firestore (recomendado para a feira);
- VPS gratuita (Oracle Cloud Free Tier) com Caddy + systemd e Firestore;
- manter local + túnel HTTPS (bom para teste, ruim para PWA de produção).
