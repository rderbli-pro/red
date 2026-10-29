import { api } from '../api.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { copyText, confirmDialog, openModal, setBusy, spinnerBlock, toast } from '../ui.js';
import { dateFull, dateTime, escapeHtml, initials } from '../util.js';

function suggestPassword() {
  const words = ['brasa', 'carvao', 'espeto', 'sabor', 'fumaca', 'tempero'];
  const word = words[Math.floor(Math.random() * words.length)];
  return `${word}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function memberMarkup(user) {
  const isSelf = user.id === state.user?.id;
  return `
    <div class="member ${isSelf ? 'is-self' : ''}" data-user="${user.id}">
      <span class="avatar avatar--lg ${user.role === 'admin' ? 'avatar--admin' : ''}">${initials(user.name)}</span>
      <div class="member__main">
        <div class="member__name">
          <strong>${escapeHtml(user.name)}</strong>
          <span class="role role--${user.role}">${user.role === 'admin' ? 'ADMIN' : 'VENDEDOR'}</span>
          ${isSelf ? '<span class="role role--self">VOCÊ</span>' : ''}
          ${user.mustChangePassword ? '<span class="role role--warn">SENHA INICIAL</span>' : ''}
        </div>
        <span class="member__handle">@${escapeHtml(user.username)} • desde ${dateFull(user.createdAt)}</span>
        <span class="member__login">${icon('clock', 12)} ${user.lastLoginAt ? `Último acesso ${dateTime(user.lastLoginAt)}` : 'Ainda não entrou'}</span>
      </div>
      <div class="member__actions">
        <button class="btn btn--ghost btn--xs" type="button" data-action="reset" data-id="${user.id}">${icon('key', 13)} SENHA</button>
        <button class="btn btn--ghost btn--xs" type="button" data-action="role" data-id="${user.id}" ${isSelf ? 'disabled title="Você não pode alterar seu próprio papel"' : ''}>
          ${user.role === 'admin' ? 'TORNAR VENDEDOR' : 'TORNAR ADMIN'}
        </button>
      </div>
    </div>
  `;
}

export async function renderTeam(host, ctx) {
  if (state.user?.role !== 'admin') {
    ctx.navigate('painel');
    return;
  }
  host.innerHTML = `<div class="team-page" data-page>${spinnerBlock('ABRINDO A ESCALA...')}</div>`;

  let users;
  let settings;
  try {
    const [usersResult, settingsResult] = await Promise.all([api.get('/api/users'), api.get('/api/settings')]);
    users = usersResult.users;
    settings = settingsResult.settings;
  } catch (error) {
    if (!ctx.isCurrent('equipe')) return;
    host.innerHTML = `<div class="team-page" data-page><div class="panel error-panel"><div class="panel__bar">ERRO</div><p>${error.message}</p><button class="btn" type="button" data-retry>TENTAR DE NOVO</button></div></div>`;
    host.querySelector('[data-retry]').addEventListener('click', () => renderTeam(host, ctx));
    return;
  }
  if (!ctx.isCurrent('equipe')) return;

  const admins = users.filter((user) => user.role === 'admin').length;

  host.innerHTML = `
    <div class="team-page" data-page>
      <div class="page-head">
        <div>
          <p class="eyebrow">ADMINISTRAÇÃO</p>
          <h1>EQUIPE</h1>
          <p class="page-sub">${users.length} membros • ${admins} administradores</p>
        </div>
        <div class="page-actions">
          <button class="btn btn--primary" type="button" data-action="new-member">${icon('plus', 14)} NOVO MEMBRO</button>
        </div>
      </div>

      <div class="team-grid">
        <section class="panel invite-panel">
          <div class="panel__bar"><span>CÓDIGO DE CONVITE</span></div>
          <div class="panel__pad">
            <p class="invite-panel__hint">Quem se cadastrar com este código entra como <strong>vendedor</strong>.</p>
            <div class="invite-code">
              <code>${escapeHtml(settings.inviteCode)}</code>
              <button class="btn btn--ghost btn--xs" type="button" data-action="copy-invite" data-code="${escapeHtml(settings.inviteCode)}">${icon('copy', 13)} COPIAR</button>
            </div>
            <form class="invite-form" data-invite-form>
              <label class="field field--inline">
                <span class="field__label">TROCAR CÓDIGO</span>
                <input class="input" name="inviteCode" value="${escapeHtml(settings.inviteCode)}" maxlength="24" autocapitalize="characters" spellcheck="false">
              </label>
              <button class="btn btn--dark btn--sm" type="submit">SALVAR</button>
            </form>
          </div>
        </section>

        <section class="panel export-panel">
          <div class="panel__bar"><span>BACKUP E RELATÓRIOS</span></div>
          <div class="panel__pad">
            <p class="invite-panel__hint">Baixe as vendas em CSV (abre no Excel) ou um backup completo dos dados.</p>
            <div class="export-actions">
              <button class="btn btn--ghost btn--sm" type="button" data-action="csv">${icon('download', 14)} VENDAS CSV</button>
              <button class="btn btn--ghost btn--sm" type="button" data-action="backup">${icon('download', 14)} BACKUP JSON</button>
            </div>
          </div>
        </section>
      </div>

      <div class="panel members-panel">
        <div class="panel__bar"><span>MEMBROS</span><span class="panel__bar-note">${users.length} CONTAS</span></div>
        <div class="member-list">
          ${users.map(memberMarkup).join('')}
        </div>
      </div>

      <section class="panel danger-panel">
        <div class="panel__bar panel__bar--danger"><span>ZONA DE PERIGO</span></div>
        <div class="panel__pad danger-panel__body">
          <div>
            <strong>Zerar todas as vendas</strong>
            <p>Apaga o histórico de pedidos e reinicia a numeração em #001. O estoque atual <u>não</u> é reposto automaticamente. Use antes da feira para limpar testes.</p>
          </div>
          <button class="btn btn--danger" type="button" data-action="reset-sales">${icon('trash', 14)} ZERAR VENDAS</button>
        </div>
      </section>
    </div>
  `;

  const page = host.querySelector('[data-page]');

  page.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'copy-invite') {
      const code = event.target.closest('[data-code]').dataset.code;
      const copied = await copyText(code);
      toast(copied ? 'Código copiado!' : 'Não foi possível copiar.', copied ? 'ok' : 'error');
      return;
    }

    if (action === 'csv') {
      api.download('/api/orders/export.csv');
      toast('Download do CSV iniciado.', 'ok');
      return;
    }

    if (action === 'backup') {
      api.download('/api/admin/backup');
      toast('Download do backup iniciado.', 'ok');
      return;
    }

    const id = event.target.closest('[data-id]')?.dataset.id;
    const user = users.find((item) => item.id === id);

    if (action === 'new-member') {
      openNewMember(host, ctx);
      return;
    }

    if (action === 'reset' && user) {
      openResetPassword(host, ctx, user);
      return;
    }

    if (action === 'role' && user) {
      if (user.id === state.user?.id) return;
      const nextRole = user.role === 'admin' ? 'vendedor' : 'admin';
      const ok = await confirmDialog({
        title: nextRole === 'admin' ? 'PROMOVER A ADMIN' : 'REBAIXAR PARA VENDEDOR',
        message:
          nextRole === 'admin'
            ? `${user.name} poderá editar preços, estoque e a equipe.`
            : `${user.name} continuará vendendo, mas perderá o acesso a preços, estoque e equipe.`,
        confirmLabel: nextRole === 'admin' ? 'PROMOVER' : 'REBAIXAR',
        danger: nextRole !== 'admin',
      });
      if (!ok) return;
      try {
        await api.patch(`/api/users/${user.id}`, { role: nextRole });
        toast(`${user.name} agora é ${nextRole === 'admin' ? 'administrador' : 'vendedor'}.`, 'ok');
        renderTeam(host, ctx);
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (action === 'reset-sales') {
      openResetSales(host, ctx);
    }
  });

  const inviteForm = page.querySelector('[data-invite-form]');
  inviteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = inviteForm.querySelector('button[type="submit"]');
    setBusy(button, true, 'SALVANDO...');
    try {
      await api.patch('/api/settings', { inviteCode: inviteForm.elements.inviteCode.value.trim().toUpperCase() });
      toast('Código de convite atualizado.', 'ok');
      renderTeam(host, ctx);
    } catch (error) {
      toast(error.message, 'error');
      setBusy(button, false);
    }
  });
}

function openNewMember(host, ctx) {
  const modal = openModal({
    title: 'NOVO MEMBRO',
    body: `
      <form class="modal-form" id="new-member-form" novalidate>
        <label class="field">
          <span class="field__label">NOME</span>
          <input class="input" name="name" maxlength="40" placeholder="Ex.: Maria Silva">
        </label>
        <label class="field">
          <span class="field__label">USUÁRIO</span>
          <input class="input" name="username" maxlength="20" placeholder="ex.: maria" autocapitalize="none" spellcheck="false">
        </label>
        <label class="field">
          <span class="field__label">SENHA TEMPORÁRIA</span>
          <span class="field__control">
            <input class="input" name="password" value="${suggestPassword()}" maxlength="100" spellcheck="false">
            <button class="field__peek" type="button" data-generate>GERAR</button>
          </span>
        </label>
        <label class="field">
          <span class="field__label">PAPEL</span>
          <select class="input" name="role">
            <option value="vendedor">Vendedor (apenas vendas)</option>
            <option value="admin">Administrador (gerencia tudo)</option>
          </select>
        </label>
        <p class="modal-form__hint">${icon('info', 14)} No próximo login, a pessoa será avisada para trocar a senha.</p>
      </form>
    `,
    actions: [
      { label: 'CANCELAR', kind: 'ghost' },
      {
        label: 'CRIAR MEMBRO',
        kind: 'primary',
        onClick: async () => {
          const form = modal.root.querySelector('#new-member-form');
          const data = Object.fromEntries(new FormData(form));
          if (!String(data.name || '').trim()) {
            toast('Informe o nome do membro.', 'error');
            form.elements.name.focus();
            return false;
          }
          if (!/^[a-z0-9][a-z0-9._-]{2,19}$/i.test(String(data.username || '').trim())) {
            toast('Usuário inválido. Use 3 a 20 letras, números, . - _', 'error');
            form.elements.username.focus();
            return false;
          }
          if (String(data.password || '').length < 6) {
            toast('A senha precisa ter pelo menos 6 caracteres.', 'error');
            form.elements.password.focus();
            return false;
          }
          try {
            await api.post('/api/users', {
              name: String(data.name).trim(),
              username: String(data.username).trim().toLowerCase(),
              password: data.password,
              role: data.role,
            });
            toast('Membro criado. Compartilhe a senha temporária.', 'ok');
            renderTeam(host, ctx);
            return true;
          } catch (error) {
            toast(error.message, 'error');
            return false;
          }
        },
      },
    ],
  });

  modal.root.querySelector('[data-generate]').addEventListener('click', () => {
    const form = modal.root.querySelector('#new-member-form');
    form.elements.password.value = suggestPassword();
  });
}

function openResetPassword(host, ctx, user) {
  const modal = openModal({
    title: `SENHA DE ${user.name.toUpperCase()}`,
    body: `
      <div class="modal-form">
        <p class="modal-form__hint">${icon('alert', 14)} Isso encerra as sessões abertas de <strong>${escapeHtml(user.name)}</strong> e define uma senha temporária.</p>
        <label class="field">
          <span class="field__label">NOVA SENHA TEMPORÁRIA</span>
          <span class="field__control">
            <input class="input" id="reset-password" value="${suggestPassword()}" maxlength="100" spellcheck="false">
            <button class="field__peek" type="button" data-generate>GERAR</button>
          </span>
        </label>
      </div>
    `,
    actions: [
      { label: 'CANCELAR', kind: 'ghost' },
      {
        label: 'REDEFINIR',
        kind: 'primary',
        onClick: async () => {
          const input = modal.root.querySelector('#reset-password');
          if (input.value.length < 6) {
            toast('A senha precisa ter pelo menos 6 caracteres.', 'error');
            input.focus();
            return false;
          }
          try {
            const result = await api.patch(`/api/users/${user.id}`, { password: input.value });
            const temp = result.temporaryPassword || input.value;
            toast(`Senha de ${user.name} redefinida.`, 'ok');
            renderTeam(host, ctx);
            setTimeout(() => {
              openModal({
                title: 'SENHA TEMPORÁRIA',
                body: `
                  <div class="temp-password">
                    <p>Entregue esta senha para <strong>${escapeHtml(user.name)}</strong>:</p>
                    <code>${escapeHtml(temp)}</code>
                    <p class="modal-form__hint">${icon('info', 14)} Ela deve ser trocada no primeiro acesso.</p>
                  </div>
                `,
                actions: [
                  {
                    label: `${icon('copy', 14)} COPIAR`,
                    kind: 'ghost',
                    onClick: async () => {
                      const copied = await copyText(temp);
                      toast(copied ? 'Senha copiada!' : 'Não foi possível copiar.', copied ? 'ok' : 'error');
                      return false;
                    },
                  },
                  { label: 'OK', kind: 'primary' },
                ],
              });
            }, 160);
            return true;
          } catch (error) {
            toast(error.message, 'error');
            return false;
          }
        },
      },
    ],
  });

  modal.root.querySelector('[data-generate]').addEventListener('click', () => {
    modal.root.querySelector('#reset-password').value = suggestPassword();
  });
}

function openResetSales(host, ctx) {
  openModal({
    title: 'ZERAR TODAS AS VENDAS',
    body: `
      <div class="modal-form">
        <p class="modal-form__hint">${icon('alert', 14)} Esta ação apaga <strong>todos os pedidos</strong> e volta a numeração para #001. Não pode ser desfeita.</p>
        <p class="modal-form__hint">O estoque atual continua como está. Ajuste em <strong>Preços e Estoque</strong> se precisar.</p>
        <label class="field">
          <span class="field__label">DIGITE <strong>APAGAR</strong> PARA CONFIRMAR</span>
          <input class="input" id="reset-confirm" placeholder="APAGAR" autocomplete="off" spellcheck="false">
        </label>
      </div>
    `,
    actions: [
      { label: 'CANCELAR', kind: 'ghost' },
      {
        label: 'ZERAR VENDAS',
        kind: 'danger',
        onClick: async () => {
          const input = document.getElementById('reset-confirm');
          if (input.value.trim().toUpperCase() !== 'APAGAR') {
            toast('Digite APAGAR para confirmar.', 'error');
            input.focus();
            return false;
          }
          try {
            const result = await api.post('/api/admin/reset-orders', { confirm: 'APAGAR' });
            toast(`${result.removed} pedidos apagados. Numeração reiniciada.`, 'ok');
            renderTeam(host, ctx);
            return true;
          } catch (error) {
            toast(error.message, 'error');
            return false;
          }
        },
      },
    ],
  });
}
