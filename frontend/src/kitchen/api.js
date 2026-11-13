// KDS-клиент кухни: отдельный лёгкий Axios-клиент вне админки.
//
// Две сессии, обе с серверным скоупом "kitchen" (доступ только к /kitchen/*):
// 1) сессия терминала — логин+пароль филиала, вводится один раз при настройке
//    экрана и хранится на устройстве (marjon_kds_device_*);
// 2) сессия повара — 4-значный PIN, живёт до конца смены (marjon_kds_token).
// Токены лежат отдельно от веб-админки, чтобы сессии не пересекались.
import axios from "axios";

export const KDS_API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

const COOK_TOKEN = "marjon_kds_token";
const COOK_REFRESH = "marjon_kds_refresh";
const COOK_NAME = "marjon_kds_cook";
const DEVICE_TOKEN = "marjon_kds_device_token";
const DEVICE_REFRESH = "marjon_kds_device_refresh";
const DEVICE_BRANCH = "marjon_kds_branch";
const DEVICE_COMPANY = "marjon_kds_company";

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
    // Игнорируем ошибки квоты — сессия просто не сохранится
  }
}

function drop(...keys) {
  try {
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Активная сессия: повар, если он вошёл, иначе сам терминал.
export function getKdsToken() {
  return read(COOK_TOKEN) || read(DEVICE_TOKEN);
}

export function isKdsAuthenticated() {
  return Boolean(read(COOK_TOKEN));
}

export function hasKdsDevice() {
  return Boolean(read(DEVICE_TOKEN) && read(DEVICE_BRANCH));
}

export function getKdsBranch() {
  return readJson(DEVICE_BRANCH);
}

export function getKdsCompany() {
  return readJson(DEVICE_COMPANY);
}

export function getKdsCookName() {
  return read(COOK_NAME);
}

export function clearKdsSession() {
  drop(COOK_TOKEN, COOK_REFRESH, COOK_NAME);
}

export function forgetKdsDevice() {
  drop(
    COOK_TOKEN,
    COOK_REFRESH,
    COOK_NAME,
    DEVICE_TOKEN,
    DEVICE_REFRESH,
    DEVICE_BRANCH,
    DEVICE_COMPANY,
  );
}

export const kdsApi = axios.create({
  baseURL: KDS_API_BASE_URL,
  timeout: 20000,
});

// Подставляем Bearer перед каждым запросом
kdsApi.interceptors.request.use((config) => {
  const token = getKdsToken();
  config.headers = config.headers || {};
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// При 401 один раз пробуем refresh, иначе чистим сессию.
// Продление идёт в тот же слот, из которого взят refresh-токен: сессия повара
// не должна «перезаписывать» привязку терминала и наоборот.
kdsApi.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;
    const url = original?.url || "";
    if (status !== 401 || original?._kdsRetry || url.includes("/auth/")) {
      return Promise.reject(error);
    }
    original._kdsRetry = true;

    const slots = [
      { refresh: read(COOK_REFRESH), tokenKey: COOK_TOKEN, refreshKey: COOK_REFRESH },
      { refresh: read(DEVICE_REFRESH), tokenKey: DEVICE_TOKEN, refreshKey: DEVICE_REFRESH },
    ].filter((slot) => slot.refresh);

    for (const slot of slots) {
      try {
        const { data } = await axios.post(`${KDS_API_BASE_URL}/auth/refresh`, {
          refresh_token: slot.refresh,
        });
        write(slot.tokenKey, data.access_token);
        if (data.refresh_token) write(slot.refreshKey, data.refresh_token);
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return kdsApi(original);
      } catch {
        // Пробуем следующий слот; если не осталось — сессия мертва
        drop(slot.tokenKey, slot.refreshKey);
      }
    }
    clearKdsSession();
    return Promise.reject(error);
  },
);

function storeSession(data) {
  if (data?.branch) write(DEVICE_BRANCH, JSON.stringify(data.branch));
  if (data?.company) write(DEVICE_COMPANY, JSON.stringify(data.company));
}

// Настройка кухонного экрана. Два способа входа:
// - "monoblock" — телефон+пароль аккаунта моноблока с правом «Кухня»
//   (карточка users/monoblock в вебе) — основной сценарий;
// - "branch" — логин+пароль филиала (старый способ, остаётся для заведений,
//   у которых ещё нет моноблока).
// Вызывается один раз на устройстве; после этого повара входят по PIN.
export async function kdsConnectDevice(login, password, { mode = "monoblock", branchId } = {}) {
  const url = mode === "branch" ? "/auth/kitchen/session" : "/auth/kitchen/monoblock-session";
  const body =
    mode === "branch"
      ? { login: String(login || "").trim(), password }
      : {
          phone: String(login || "").trim(),
          password,
          ...(branchId ? { branch_id: branchId } : {}),
        };
  const { data } = await kdsApi.post(url, body);
  write(DEVICE_TOKEN, data.access_token);
  write(DEVICE_REFRESH, data.refresh_token);
  storeSession(data);
  clearKdsSession();
  return data;
}

// Повара филиала для экрана выбора. После настройки экран помнит филиал,
// поэтому список приходит по кухонной сессии терминала.
export async function kdsGetCooks() {
  const { data } = await kdsApi.get("/auth/kitchen/cooks");
  return Array.isArray(data) ? data : [];
}

// Вход повара по PIN. Терминал уже привязан к филиалу; user_id сужает
// проверку до выбранного на экране сотрудника.
export async function kdsPinLogin(pin, userId) {
  const { data } = await kdsApi.post("/auth/kitchen/pin", {
    pin: String(pin || ""),
    ...(userId ? { user_id: userId } : {}),
  });
  write(COOK_TOKEN, data.access_token);
  write(COOK_REFRESH, data.refresh_token);
  write(COOK_NAME, data.user_name || "");
  storeSession(data);
  return data;
}

// Выход повара: терминал остаётся привязанным, следующий повар вводит свой PIN.
export async function kdsCookLogout() {
  const refreshToken = read(COOK_REFRESH);
  const accessToken = read(COOK_TOKEN);
  clearKdsSession();
  if (!refreshToken) return;
  try {
    await kdsApi.post(
      "/auth/logout",
      { refresh_token: refreshToken },
      accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    );
  } catch {
    // Локально уже вышли — ошибку сервера игнорируем
  }
}

export const kdsGetOrders = () => kdsApi.get("/kitchen/orders").then((r) => r.data);

// Перевод позиции: pending -> cooking -> ready (цепочку проверяет бэкенд)
export const kdsSetItemStatus = (orderItemId, status) =>
  kdsApi.patch("/kitchen/orders/items/status", { order_item_id: orderItemId, status }).then((r) => r.data);

// Весь заказ готов (уведомляет официанта). Кухонный скоуп не пускает в /pos,
// поэтому у кухни своя ручка.
export const kdsSetOrderReady = (orderId) =>
  kdsApi.patch(`/kitchen/orders/${orderId}/ready`).then((r) => r.data);

// WS-URL кухни из REST-базы (http -> ws, https -> wss)
export function kdsWsUrl(branchId) {
  const token = getKdsToken();
  const branch = branchId || getKdsBranch()?.id;
  if (!token || !branch) return null;
  try {
    const url = new URL(KDS_API_BASE_URL);
    const proto = url.protocol === "https:" ? "wss:" : "ws:";
    // KDS_API_BASE_URL заканчивается на /api/v1 — путь WS идёт от корня хоста
    return `${proto}//${url.host}/ws/kitchen?token=${encodeURIComponent(token)}&branch_id=${encodeURIComponent(branch)}`;
  } catch {
    return null;
  }
}
