import { API_BASE } from './config.js';

const TOKEN_KEY = 'cipher:token';

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function tokenPresent() {
  return Boolean(getToken());
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (res.status === 401 && token && path !== '/auth/me') {
    window.dispatchEvent(new CustomEvent('cipher:unauthorized'));
  }

  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  signup: (body) => request('/api/auth/signup', { method: 'POST', body }),
  login: (body) => request('/api/auth/login', { method: 'POST', body }),
  me: () => request('/api/auth/me'),
  storeKey: (spki) => request('/api/auth/keys', { method: 'PUT', body: { spki } }),
  searchUsers: (q) => request(`/api/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getUser: (id) => request(`/api/users/${id}`),
  patchAccount: (body) => request('/api/account', { method: 'PATCH', body }),
  conversations: () => request('/api/conversations'),
  thread: (peerId, before, limit) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return request(`/api/messages/${peerId}${qs ? `?${qs}` : ''}`);
  },
  sendMessage: (peerId, body) => request(`/api/messages/${peerId}`, { method: 'POST', body }),
  markRead: (messageId) => request(`/api/messages/${messageId}/read`, { method: 'POST' })
};