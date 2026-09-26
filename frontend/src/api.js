const TOKEN_KEY = "cloud_ide_token";
const USERNAME_KEY = "cloud_ide_username";

// Inc dev, requests to /api/* are proxied to the backend by Vite (see
// vite.config.js), which also strips the /api prefix — so leave paths
// alone here. In production there's no dev-server proxy, so set
// VITE_API_BASE (e.g. in Vercel's project settings) to the deployed
// backend's URL, and we hit it directly, stripping /api ourselves since
// the backend's own routes aren't prefixed with it (see server.js).
const API_BASE = import.meta.env.VITE_API_BASE || "";

export function apiUrl(path) {
  if (!API_BASE) return path;
  return `${API_BASE}${path.replace(/^\/api/, "")}`;
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUsername() {
  return localStorage.getItem(USERNAME_KEY);
}

export function saveSession(token, username) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USERNAME_KEY, username);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}

async function authedFetch(url, options = {}) {
  const token = getToken();
  const res = await fetch(apiUrl(url), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function register(username, password) {
  const data = await authedFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  saveSession(data.token, data.username);
  return data;
}

export async function login(username, password) {
  const data = await authedFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  saveSession(data.token, data.username);
  return data;
}

export function listSnippets() {
  return authedFetch("/api/snippets");
}

export function getSnippet(id) {
  return authedFetch(`/api/snippets/${id}`);
}

export function createSnippet({ title, language, code }) {
  return authedFetch("/api/snippets", {
    method: "POST",
    body: JSON.stringify({ title, language, code }),
  });
}

export function updateSnippet(id, { title, code }) {
  return authedFetch(`/api/snippets/${id}`, {
    method: "PUT",
    body: JSON.stringify({ title, code }),
  });
}

export function deleteSnippet(id) {
  return authedFetch(`/api/snippets/${id}`, { method: "DELETE" });
}
