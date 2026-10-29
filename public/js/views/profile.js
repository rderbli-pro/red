import { icon } from '../icons.js';
import { state } from '../state.js';
import { confirmDialog, setBusy, toast } from '../ui.js';
import { dateFull, dateTime, initials } from '../util.js';

export function renderProfile(host, ctx) {
  const user = state.user;
  if (!user) return;

  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  const installMarkup = standalone
    ? '<p class="invite-panel__hint">Você já está usando a Rasec instalada neste aparelho.</p>'
    : `
      <p class="invite-panel__hint">Instale a Rasec na tela inicial para abrir em tela cheia e com acesso rápido, como um aplicativo.</p>
      ${
        ctx.canInstall()
          ? `<button class="btn btn--primary btn--sm" type="button" data-install>${icon('download', 14)} INSTALAR APP</button>`
          : ''
      }
      <p class="modal-form__hint">${icon('info', 13)} Android: menu ⋮ → Instalar app. iPhone: Compartilhar → Adicionar à Tela de Início.</p>
    `;

  host.innerHTML = `
    <div class="profile-page" data-page>
      <div class="page-head">
        <div>
          <p class="eyebrow">CONTA</p>
          <h1>MEU PERFIL</h1>
          <p class="page-sub">Sua conta na equipe Rasec</p>
        </div>
      </div>

      ${
        user.mustChangePassword
          ? `<div class="alert alert--gold profile-alert">${icon('key', 20)}<span><strong>Você ainda usa a senha inicial.</strong> Troque agora para proteger a barraca.</span><a class="btn btn--dark btn--xs" href="#/perfil" data-focus-password>ALTERAR</a></div>`
          : ''
      }

      <div class="profile-grid">
        <section class="panel profile-card">
          <div class="panel__bar"><span>CONTA</span><span class="panel__bar-note">${user.role === 'admin' ? 'ADMIN' : 'VENDEDOR'}</span></div>
          <div class="profile-card__body">
            <span class="avatar avatar--xl ${user.role === 'admin' ? 'avatar--admin' : ''}">${initials(user.name)}</span>
            <h2>${user.name}</h2>
            <p class="profile-card__handle">@${user.username}</p>
            <div class="profile-card__meta">
              <span>${icon('shield', 14)} ${user.role === 'admin' ? 'Administrador' : 'Vendedor'}</span>
              <span>${icon('clock', 14)} Desde ${dateFull(user.createdAt)}</span>
              <span>${icon('users', 14)} ${user.lastLoginAt ? `Último acesso ${dateTime(user.lastLoginAt)}` : 'Primeiro acesso'}</span>
            </div>
            <div class="profile-card__actions">
              ${user.role === 'admin' ? `<a class="btn btn--ghost btn--sm" href="#/equipe">${icon('users', 14)} EQUIPE</a>` : ''}
              <a class="btn btn--ghost btn--sm" href="#/estoque">${icon('box', 14)} ESTOQUE</a>
            </div>
          </div>
        </section>

        <section class="panel password-panel">
          <div class="panel__bar"><span>TROCAR SENHA</span></div>
          <div class="panel__pad">
            <form class="password-form" data-password-form novalidate>
              <label class="field">
                <span class="field__label">SENHA ATUAL</span>
                <input class="input" type="password" name="currentPassword" autocomplete="current-password" required>
              </label>
              <label class="field">
                <span class="field__label">NOVA SENHA</span>
                <input class="input" type="password" name="newPassword" autocomplete="new-password" minlength="6" required placeholder="mínimo 6 caracteres">
              </label>
              <label class="field">
                <span class="field__label">CONFIRMAR NOVA SENHA</span>
                <input class="input" type="password" name="confirmPassword" autocomplete="new-password" required>
              </label>
              <button class="btn btn--primary" type="submit">${icon('key', 15)} SALVAR NOVA SENHA</button>
              <p class="modal-form__hint">${icon('info', 13)} As outras sessões da sua conta serão encerradas.</p>
            </form>
          </div>
        </section>

        <section class="panel session-panel">
          <div class="panel__bar"><span>SESSÃO</span></div>
          <div class="panel__pad">
            <p class="invite-panel__hint">Sessão segura de 7 dias neste aparelho. Ao sair, será preciso entrar novamente.</p>
            <button class="btn btn--danger" type="button" data-logout>${icon('logout', 15)} SAIR DA CONTA</button>
          </div>
        </section>

        <section class="panel install-panel">
          <div class="panel__bar"><span>APP NO CELULAR</span><span class="panel__bar-note">PWA</span></div>
          <div class="panel__pad">
            ${installMarkup}
          </div>
        </section>
      </div>

      <div class="about-strip">
        <img src="/assets/logo-rasec.svg" alt="" width="42" height="42">
        <div>
          <strong>Rasec - Espetinhos</strong>
          <span>Feira de Empreendedorismo • C.E.P.K 2026 • v1.0</span>
        </div>
        <span class="about-strip__tag">${icon('flame', 14)} NA BRASA</span>
      </div>
    </div>
  `;

  const page = host.querySelector('[data-page]');
  const form = page.querySelector('[data-password-form]');

  page.querySelector('[data-focus-password]')?.addEventListener('click', (event) => {
    event.preventDefault();
    form.elements.currentPassword.focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    const confirmPassword = form.elements.confirmPassword.value;
    if (!currentPassword) {
      toast('Informe sua senha atual.', 'error');
      form.elements.currentPassword.focus();
      return;
    }
    if (newPassword.length < 6) {
      toast('A nova senha precisa ter pelo menos 6 caracteres.', 'error');
      form.elements.newPassword.focus();
      return;
    }
    if (newPassword !== confirmPassword) {
      toast('As senhas novas não conferem.', 'error');
      form.elements.confirmPassword.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, 'SALVANDO...');
    try {
      const result = await ctx.api.post('/api/auth/password', { currentPassword, newPassword });
      if (result.user) state.user = result.user;
      else state.user.mustChangePassword = false;
      toast('Senha alterada com sucesso!', 'ok');
      renderProfile(host, ctx);
    } catch (error) {
      toast(error.message, 'error');
      setBusy(button, false);
    }
  });

  page.querySelector('[data-logout]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'SAIR DA CONTA',
      message: 'Deseja encerrar a sessão neste aparelho?',
      confirmLabel: 'SAIR',
      cancelLabel: 'CANCELAR',
      danger: true,
    });
    if (ok) ctx.logout();
  });

  page.querySelector('[data-install]')?.addEventListener('click', async () => {
    const installed = await ctx.install();
    if (installed) toast('Instalação iniciada. Confirme no navegador.', 'ok');
    else toast('Para instalar, use o menu do navegador.', 'info');
  });
}
