import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api/v1";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Очередь запросов, ждущих обновления токена
let isRefreshing = false;
let refreshSubscribers = [];

function onTokenRefreshed(token) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb) {
  refreshSubscribers.push(cb);
}

async function refreshAccessToken() {
  const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refresh) throw new Error("no_refresh_token");
  // Прямой axios (без интерсепторов), чтобы не зациклиться
  const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
    refresh_token: refresh,
  });
  localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  if (data.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
  }
  return data.access_token;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const url = originalRequest?.url || "";

    // 401 — пытаемся обновить токен один раз
    if (status === 401 && !originalRequest._retry && !url.includes("/auth/login") && !url.includes("/auth/refresh")) {
      originalRequest._retry = true;

      if (isRefreshing) {
        // Дождаться текущего refresh
        return new Promise((resolve, reject) => {
          addRefreshSubscriber((token) => {
            if (!token) {
              reject(error);
              return;
            }
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;
      try {
        const newToken = await refreshAccessToken();
        onTokenRefreshed(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        onTokenRefreshed(null);
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        // Принудительный logout — редирект на login
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export async function login(email, password) {
  const { data } = await api.post("/auth/login", { email, password });
  saveTokens(data);
  return data;
}

export async function loginByPhone(phone, password) {
  const { data } = await api.post("/auth/login", { phone, password });
  saveTokens(data);
  return data;
}

export async function loginByPin(employee_id, pin) {
  const { data } = await api.post("/auth/pin-login", { employee_id, pin });
  saveTokens(data);
  return data;
}

export async function fetchStaffUsers() {
  const { data } = await api.get("/auth/staff-users");
  return data;
}

function saveTokens(data) {
  if (data.access_token) localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  if (data.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
}

export function logout() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function isAuthenticated() {
  return Boolean(localStorage.getItem(ACCESS_TOKEN_KEY));
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function formatMoney(value, currency = "UZS") {
  const number = Number(value || 0);
  return `${number.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ${currency}`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}
