import axios from "axios";
import {
  AUTH_SCOPES,
  clearAuthTokens,
  getAccessToken,
  handleAuthResponseError,
  prepareAuthRequest,
  resolveAdminAuthSession,
  saveAuthTokens,
} from "../auth/session";
import { createFetchAdapter, DEFAULT_HTTP_TIMEOUT_MS } from "../api/transport";

export const ADMIN_API_BASE_URL = import.meta.env.VITE_ADMIN_API_URL || "http://127.0.0.1:8000/api/v1";

export const adminApi = axios.create({
  baseURL: ADMIN_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: DEFAULT_HTTP_TIMEOUT_MS,
  adapter: createFetchAdapter({ defaultTimeout: DEFAULT_HTTP_TIMEOUT_MS }),
});

adminApi.interceptors.request.use((config) => {
  const session = resolveAdminAuthSession();
  return prepareAuthRequest(config, {
    scope: AUTH_SCOPES.ADMIN,
    accessToken: session.accessToken,
  });
});

adminApi.interceptors.response.use(
  (response) => response,
  (error) => handleAuthResponseError(error, {
    client: adminApi,
    baseURL: ADMIN_API_BASE_URL,
    resolveScope: resolveAdminAuthSession,
  }),
);

function normalizeAdminPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 9) return `+998${digits}`;
  return digits.startsWith("998") ? `+${digits}` : `+${digits}`;
}

export async function adminLogin(phone, password) {
  const normalizedPhone = normalizeAdminPhone(phone);
  const { data } = await adminApi.post("/auth/login", { phone: normalizedPhone, password });
  saveAuthTokens(data, { scope: AUTH_SCOPES.ADMIN });
  return data;
}

export function adminLogout() {
  clearAuthTokens({ scope: AUTH_SCOPES.ADMIN });
}

export function isAdminAuthenticated() {
  return Boolean(getAccessToken({ scope: AUTH_SCOPES.ADMIN }));
}
