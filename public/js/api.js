export class ApiError extends Error {
  constructor(message, status = 0, code = 'error', fields = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function request(path, options = {}) {
  const { method = 'GET', body, signal } = options;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Sem conexão com o servidor. Confira se ele ainda está rodando.', 0, 'network');
  }

  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('rasec:unauthorized'));
    }
    throw new ApiError(
      data?.error || `Não foi possível concluir (erro ${response.status}).`,
      response.status,
      data?.code || 'error',
      data?.fields || null,
    );
  }

  return data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  download: (path) => {
    const link = document.createElement('a');
    link.href = path;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  },
};
