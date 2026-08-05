import axios from "axios";
import {
  AUTH_SCOPES,
  endAuthSession,
  getAccessToken as readAccessToken,
  handleAuthResponseError,
  hasAccessToken,
  prepareAuthRequest,
  saveAuthTokens,
} from "../auth/session";
import { createFetchAdapter, DEFAULT_HTTP_TIMEOUT_MS } from "./transport";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: DEFAULT_HTTP_TIMEOUT_MS,
  adapter: createFetchAdapter({ defaultTimeout: DEFAULT_HTTP_TIMEOUT_MS }),
});

api.interceptors.request.use((config) => {
  const token = readAccessToken({ scope: AUTH_SCOPES.DEFAULT });
  return prepareAuthRequest(config, { scope: AUTH_SCOPES.DEFAULT, accessToken: token });
});

api.interceptors.response.use(
  (response) => response,
  (error) => handleAuthResponseError(error, { client: api, baseURL: API_BASE_URL, scope: AUTH_SCOPES.DEFAULT }),
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
  saveAuthTokens(data, { scope: AUTH_SCOPES.DEFAULT });
}

export function logout() {
  endAuthSession("logout", { scope: AUTH_SCOPES.ALL });
}

export function isAuthenticated() {
  return hasAccessToken({ scope: AUTH_SCOPES.DEFAULT });
}

export function getAccessToken() {
  return readAccessToken({ scope: AUTH_SCOPES.DEFAULT });
}

export function formatMoney(value, currency = "UZS") {
  const number = Number(value || 0);
  return `${number.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ${currency}`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}
