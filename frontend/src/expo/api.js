// Клиент экрана «Раздача» (expo). Отдельная сессия от кухни и админки:
// сотрудник входит телефоном и паролем, бэкенд пускает только с правом
// can_expo (или владельца/админа). Токен живёт в своём слоте localStorage.
import axios from "axios";

export const EXPO_API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

const TOKEN = "marjon_expo_token";
const REFRESH = "marjon_expo_refresh";
const USER = "marjon_expo_user";

function read(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function write(key, value) {
  if (!value) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota errors
  }
}

export function getExpoToken() {
  return read(TOKEN);
}

export function getExpoUser() {
  try {
    const raw = read(USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isExpoAuthenticated() {
  return Boolean(read(TOKEN));
}

export function clearExpoSession() {
  try {
    [TOKEN, REFRESH, USER].forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

export const expoApi = axios.create({
  baseURL: EXPO_API_BASE_URL,
  timeout: 20000,
});

expoApi.interceptors.request.use((config) => {
  const token = getExpoToken();
  config.headers = config.headers || {};
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

expoApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;
    const url = original?.url || "";
    if (status !== 401 || original?._expoRetry || url.includes("/auth/")) {
      return Promise.reject(error);
    }
    original._expoRetry = true;
    const refreshToken = read(REFRESH);
    if (!refreshToken) {
      clearExpoSession();
      return Promise.reject(error);
    }
    try {
      const { data } = await axios.post(`${EXPO_API_BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      });
      write(TOKEN, data.access_token);
      if (data.refresh_token) write(REFRESH, data.refresh_token);
      original.headers = original.headers || {};
      original.headers.Authorization = `Bearer ${data.access_token}`;
      return expoApi(original);
    } catch {
      clearExpoSession();
      return Promise.reject(error);
    }
  },
);

// Вход раздачи: телефон + пароль сотрудника (не PIN, не логин филиала).
export async function expoLogin(phone, password) {
  const { data } = await axios.post(`${EXPO_API_BASE_URL}/auth/login`, {
    phone: String(phone || "").trim(),
    password,
  });
  write(TOKEN, data.access_token);
  write(REFRESH, data.refresh_token);
  const me = await expoApi.get("/auth/me").then((r) => r.data);
  write(USER, JSON.stringify(me));
  return me;
}

export async function expoLogout() {
  const refreshToken = read(REFRESH);
  const accessToken = read(TOKEN);
  clearExpoSession();
  if (!refreshToken) return;
  try {
    await axios.post(
      `${EXPO_API_BASE_URL}/auth/logout`,
      { refresh_token: refreshToken },
      accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    );
  } catch {
    // локально уже вышли — ответ сервера не важен
  }
}

export const fetchExpoOrders = () =>
  expoApi.get("/kitchen/expo/orders").then((r) => r.data);

export const confirmExpoOrder = (orderId) =>
  expoApi.patch(`/kitchen/expo/orders/${orderId}/confirm`).then((r) => r.data);
