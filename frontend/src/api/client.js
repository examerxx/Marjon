import axios from "axios";

// In production (Vercel) set VITE_API_URL to your Render backend, e.g.:
//   https://marjon-api.onrender.com/api/v1
// In dev, vite proxy forwards /api → localhost:8000
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || "/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// ── Request: attach access token ─────────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response: handle 401 with optional refresh ───────────────────────────────
let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Skip if not 401, or already retried, or it's the refresh/login call itself
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes("/auth/login") ||
      original.url?.includes("/auth/refresh")
    ) {
      if (error.response?.status === 401) {
        forceLogout();
      }
      return Promise.reject(error);
    }

    // Try to refresh the token
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) {
      forceLogout();
      return Promise.reject(error);
    }

    original._retry = true;

    try {
      // Deduplicate concurrent refresh calls
      if (!refreshPromise) {
        refreshPromise = axios
          .post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
          .finally(() => { refreshPromise = null; });
      }

      const { data } = await refreshPromise;
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      original.headers.Authorization = `Bearer ${data.access_token}`;
      return api(original);
    } catch {
      forceLogout();
      return Promise.reject(error);
    }
  },
);

function forceLogout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  // Redirect to login if not already there
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

export async function login(email, password) {
  const { data } = await api.post("/auth/login", { email, password });
  localStorage.setItem("access_token", data.access_token);
  localStorage.setItem("refresh_token", data.refresh_token);
  return data;
}

export function logout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

export function isAuthenticated() {
  return Boolean(localStorage.getItem("access_token"));
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatMoney(value, currency = "UZS") {
  const number = Number(value || 0);
  return `${number.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ${currency}`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}
