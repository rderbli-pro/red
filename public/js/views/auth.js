import { icon } from '../icons.js';
import { escapeHtml } from '../util.js';
import { setBusy, toast } from '../ui.js';

export function renderLogin(root, { api, onSuccess, notice = '' }) {
  root.innerHTML = `
    <div class="login">
      <div class="login__bg" aria-hidden="true"></div>
      <section class="login__brand" aria-label="Rasec - Espetinhos">
        <div class="login__badge-wrap">
          <img class="login__logo" src="/assets/logo-rasec.svg" alt="Logo da Rasec: rosto de um homem de óculos e barba" width="168" height="168">
          <span class="login__stamp">C.E.P.K</span>
        </div>
        <p class="login__kicker">FEIRA DE EMPREENDEDORISMO</p>
        <h1 class="login__title">RASEC</h1>
        <p class="login__subtitle">ESPETINHOS</p>
        <p class="login__tagline">Carne, frango e linguiça.<br>Na brasa, feito na hora.</p>
        <span class="login__ribbon">NOVO!</span>
        <img class="login__skewer" src="/assets/espeto-carne.svg" alt="" width="120" height="218">
      </section>

      <section class="login__panel panel" aria-labelledby="login-heading">
        <div class="panel__bar"><span id="login-heading">ACESSO DA EQUIPE</span><span class="panel__bar-dots" aria-hidden="true">▮▮▮</span></div>
        <div class="login__tabs" role="tablist" aria-label="Entrar ou cadastrar">
          <button type="button" class="login__tab is-active" id="tab-login" role="tab" aria-selected="true" aria-controls="panel-login" data-tab="login">ENTRAR</button>
          <button type="button" class="login__tab" id="tab-signup" role="tab" aria-selected="false" aria-controls="panel-signup" data-tab="signup">CADASTRO</button>
        </div>

        ${notice ? `<div class="login__notice" role="status">${icon('info', 18)}<span>${escapeHtml(notice)}</span></div>` : ''}

        <div class="login__body">
          <div class="login__pane" id="panel-login" role="tabpanel" aria-labelledby="tab-login" data-pane="login">
            <p class="login__hint"><span class="blink" aria-hidden="true">▶</span> Entre com sua conta para abrir a barraca.</p>
            <div class="login__error" data-error hidden></div>
            <form class="login__form" data-form="login" novalidate>
              <label class="field">
                <span class="field__label">USUÁRIO</span>
                <input class="input" name="username" autocomplete="username" placeholder="ex.: bruno" required maxlength="20" spellcheck="false" autocapitalize="none">
                <span class="field__error" data-error-for="username"></span>
              </label>
              <label class="field">
                <span class="field__label">SENHA</span>
                <span class="field__control">
                  <input class="input" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
                  <button type="button" class="field__peek" data-peek>MOSTRAR</button>
                </span>
                <span class="field__error" data-error-for="password"></span>
              </label>
              <button class="btn btn--block btn--lg" type="submit" data-submit>ENTRAR ${icon('arrowRight', 16)}</button>
            </form>
            <p class="login__help">Esqueceu a senha? Peça a um administrador para redefinir.</p>
          </div>

          <div class="login__pane" id="panel-signup" role="tabpanel" aria-labelledby="tab-signup" data-pane="signup" hidden>
            <p class="login__hint"><span class="blink" aria-hidden="true">▶</span> Novo na equipe? Use o código de convite.</p>
            <div class="login__error" data-error hidden></div>
            <form class="login__form" data-form="signup" novalidate>
              <label class="field">
                <span class="field__label">NOME</span>
                <input class="input" name="name" autocomplete="name" placeholder="ex.: Maria Silva" required maxlength="40">
                <span class="field__error" data-error-for="name"></span>
              </label>
              <label class="field">
                <span class="field__label">USUÁRIO</span>
                <input class="input" name="username" autocomplete="username" placeholder="ex.: maria" required maxlength="20" spellcheck="false" autocapitalize="none">
                <span class="field__error" data-error-for="username"></span>
              </label>
              <label class="field">
                <span class="field__label">SENHA</span>
                <span class="field__control">
                  <input class="input" name="password" type="password" autocomplete="new-password" placeholder="mínimo 6 caracteres" required>
                  <button type="button" class="field__peek" data-peek>MOSTRAR</button>
                </span>
                <span class="field__error" data-error-for="password"></span>
              </label>
              <label class="field">
                <span class="field__label">CÓDIGO DA EQUIPE</span>
                <input class="input" name="inviteCode" placeholder="RASEC2026" required maxlength="24" autocapitalize="characters" spellcheck="false">
                <span class="field__error" data-error-for="inviteCode"></span>
              </label>
              <button class="btn btn--block btn--lg" type="submit" data-submit>CRIAR CONTA ${icon('arrowRight', 16)}</button>
            </form>
          </div>
        </div>

        <div class="login__foot">
          <span class="blink" aria-hidden="true">▼</span>
          <span>Rasec - Espetinhos • v1.0</span>
        </div>
      </section>
    </div>
  `;

  const tabs = [...root.querySelectorAll('[data-tab]')];
  const panes = [...root.querySelectorAll('[data-pane]')];
  const errorBoxes = [...root.querySelectorAll('.login__error')];

  function showTab(name) {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    for (const pane of panes) pane.hidden = pane.dataset.pane !== name;
    hideErrors();
    const pane = root.querySelector(`[data-pane="${name}"]`);
    pane?.querySelector('input')?.focus({ preventScroll: true });
  }

  for (const tab of tabs) tab.addEventListener('click', () => showTab(tab.dataset.tab));

  for (const peek of root.querySelectorAll('[data-peek]')) {
    peek.addEventListener('click', () => {
      const input = peek.parentElement.querySelector('input');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      peek.textContent = visible ? 'MOSTRAR' : 'OCULTAR';
    });
  }

  function hideErrors() {
    for (const box of errorBoxes) {
      box.hidden = true;
      box.innerHTML = '';
    }
    for (const field of root.querySelectorAll('[data-error-for]')) field.textContent = '';
    for (const input of root.querySelectorAll('.input')) input.removeAttribute('aria-invalid');
  }

  function showError(error, form) {
    const pane = form.closest('[data-pane]');
    const box = pane.querySelector('.login__error');
    box.hidden = false;
    box.innerHTML = `${icon('alert', 18)}<span>${escapeHtml(error.message || 'Não foi possível entrar.')}</span>`;
    if (error.fields) {
      for (const [name, message] of Object.entries(error.fields)) {
        const input = form.elements[name];
        const slot = pane.querySelector(`[data-error-for="${name}"]`);
        if (input) input.setAttribute('aria-invalid', 'true');
        if (slot) slot.textContent = message;
      }
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function submit(form, kind) {
    hideErrors();
    const data = Object.fromEntries(new FormData(form));
    if (kind === 'login') {
      if (!data.username.trim() || !data.password) {
        showError({ message: 'Preencha usuário e senha.', fields: {
          ...(data.username.trim() ? {} : { username: 'Informe seu usuário.' }),
          ...(data.password ? {} : { password: 'Informe sua senha.' }),
        } }, form);
        return;
      }
    } else {
      const fields = {};
      if (!String(data.name || '').trim() || String(data.name).trim().length < 2) fields.name = 'Informe seu nome.';
      if (!/^[a-z0-9][a-z0-9._-]{2,19}$/i.test(String(data.username || '').trim())) {
        fields.username = '3 a 20 caracteres: letras, números, . - _';
      }
      if (String(data.password || '').length < 6) fields.password = 'Mínimo de 6 caracteres.';
      if (!String(data.inviteCode || '').trim()) fields.inviteCode = 'Informe o código da equipe.';
      if (Object.keys(fields).length) {
        showError({ message: 'Confira os campos destacados.', fields }, form);
        return;
      }
    }

    const button = form.querySelector('[data-submit]');
    setBusy(button, true, kind === 'login' ? 'ENTRANDO...' : 'CRIANDO...');
    try {
      const payload =
        kind === 'login'
          ? { username: data.username.trim().toLowerCase(), password: data.password }
          : {
              name: String(data.name).trim(),
              username: String(data.username).trim().toLowerCase(),
              password: data.password,
              inviteCode: String(data.inviteCode).trim().toUpperCase(),
            };
      const result = await api.post(kind === 'login' ? '/api/auth/login' : '/api/auth/register', payload);
      toast(kind === 'login' ? `Bem-vindo, ${result.user.name}!` : `Conta criada. Bem-vindo, ${result.user.name}!`, 'ok');
      onSuccess(result.user, { welcome: kind === 'login' });
    } catch (error) {
      showError(error, form);
    } finally {
      setBusy(button, false);
    }
  }

  for (const form of root.querySelectorAll('[data-form]')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit(form, form.dataset.form);
    });
  }
}
