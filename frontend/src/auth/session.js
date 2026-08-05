import axios from "axios";

export const AUTH_SCOPES = {
  DEFAULT: "default",
  ADMIN: "admin",
  ALL: "all",
};

export const AUTH_STORAGE_KEYS = {
  accessToken: "access_token",
  refreshToken: "refresh_token",
  adminAccessToken: "admin_access_token",
  adminRefreshToken: "admin_refresh_token",
};

export const AUTH_SESSION_ENDED_EVENT = "marjon:auth-session-ended";

const AUTH_REFRESH_PATH = "/auth/refresh";
const AUTH_REFRESH_EXCLUDED_PATHS = ["/auth/login", "/auth/pin-login", AUTH_REFRESH_PATH];
const AUTH_SCOPE_VALUES = new Set([AUTH_SCOPES.DEFAULT, AUTH_SCOPES.ADMIN]);

const refreshPromises = {
  [AUTH_SCOPES.DEFAULT]: null,
  [AUTH_SCOPES.ADMIN]: null,
};
const sessionEndEmittedScopes = new Set();

function storage() {
  return typeof window !== "undefined" ? window.localStorage : null;
}

function normalizeScope(scope) {
  return AUTH_SCOPE_VALUES.has(scope) ? scope : AUTH_SCOPES.DEFAULT;
}

function normalizeCleanupScope(scope) {
  return scope === AUTH_SCOPES.ALL ? AUTH_SCOPES.ALL : normalizeScope(scope);
}

function readStorageKey(key) {
  try {
    return storage()?.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStorageKey(key, value) {
  if (!value) return;
  try {
    storage()?.setItem(key, value);
  } catch {
    // Ignore storage failures so auth flow can still reject predictably.
  }
}

function removeStorageKey(key) {
  try {
    storage()?.removeItem(key);
  } catch {
    // Ignore storage failures during logout/session cleanup.
  }
}

function tokenKeysForScope(scope) {
  if (normalizeScope(scope) === AUTH_SCOPES.ADMIN) {
    return {
      accessToken: AUTH_STORAGE_KEYS.adminAccessToken,
      refreshToken: AUTH_STORAGE_KEYS.adminRefreshToken,
    };
  }
  return {
    accessToken: AUTH_STORAGE_KEYS.accessToken,
    refreshToken: AUTH_STORAGE_KEYS.refreshToken,
  };
}

function getPathname(url) {
  try {
    return new URL(String(url || ""), "http://marjon.local").pathname;
  } catch {
    return String(url || "");
  }
}

function joinUrl(baseURL, path) {
  return `${String(baseURL || "").replace(/\/+$/, "")}${path}`;
}

function getRequestUrl(config) {
  return config?.url || "";
}

function getRequestBaseURL(config, fallbackBaseURL) {
  return config?.baseURL || fallbackBaseURL || "";
}

function getTokenRecord(scope) {
  const normalizedScope = normalizeScope(scope);
  const keys = tokenKeysForScope(normalizedScope);
  return {
    scope: normalizedScope,
    accessToken: readStorageKey(keys.accessToken),
    refreshToken: readStorageKey(keys.refreshToken),
  };
}

function isValidTokenResponse(data) {
  return Boolean(data?.access_token && data?.refresh_token);
}

function isFormDataBody(data) {
  return typeof FormData !== "undefined" && data instanceof FormData;
}

function removeContentTypeHeader(headers) {
  if (!headers) return;
  if (typeof headers.delete === "function") {
    headers.delete("Content-Type");
    return;
  }
  delete headers["Content-Type"];
  delete headers["content-type"];
}

function setAuthorizationHeader(config, token) {
  config.headers = config.headers || {};
  config.headers.Authorization = `Bearer ${token}`;
}

function getCallerSignal(config) {
  return config?._callerSignal || config?.signal;
}

function createRequestAbortedError(config) {
  const error = new Error("Request was aborted");
  error.name = "AbortError";
  error.code = "ABORTED";
  error.config = config;
  return error;
}

function resetSessionEventForScope(scope) {
  const normalizedScope = normalizeScope(scope);
  sessionEndEmittedScopes.delete(normalizedScope);
  sessionEndEmittedScopes.delete(AUTH_SCOPES.ALL);
}

export function getAuthScope(value) {
  return normalizeScope(value);
}

export function resolveAdminAuthSession() {
  return getTokenRecord(AUTH_SCOPES.ADMIN);
}

export function prepareAuthRequest(config, { scope = AUTH_SCOPES.DEFAULT, accessToken = "" } = {}) {
  config._authScope = normalizeScope(scope);
  if (config.signal && !config._callerSignal) {
    config._callerSignal = config.signal;
    delete config.signal;
  }
  config.headers = config.headers || {};
  if (isFormDataBody(config.data)) {
    removeContentTypeHeader(config.headers);
  }
  if (accessToken) {
    setAuthorizationHeader(config, accessToken);
  }
  return config;
}

export function getAccessToken({ scope = AUTH_SCOPES.DEFAULT } = {}) {
  return getTokenRecord(scope).accessToken;
}

export function getRefreshToken({ scope = AUTH_SCOPES.DEFAULT } = {}) {
  return getTokenRecord(scope).refreshToken;
}

export function hasAccessToken({ scope = AUTH_SCOPES.DEFAULT } = {}) {
  return Boolean(getAccessToken({ scope }));
}

export function saveAuthTokens(data, { scope = AUTH_SCOPES.DEFAULT } = {}) {
  if (!data?.access_token) return false;

  const normalizedScope = normalizeScope(scope);
  const keys = tokenKeysForScope(normalizedScope);
  writeStorageKey(keys.accessToken, data.access_token);
  if (data.refresh_token) {
    writeStorageKey(keys.refreshToken, data.refresh_token);
  }
  resetSessionEventForScope(normalizedScope);
  return true;
}

export function clearAuthTokens({ scope = AUTH_SCOPES.ALL } = {}) {
  const cleanupScope = normalizeCleanupScope(scope);
  if (cleanupScope === AUTH_SCOPES.DEFAULT || cleanupScope === AUTH_SCOPES.ALL) {
    removeStorageKey(AUTH_STORAGE_KEYS.accessToken);
    removeStorageKey(AUTH_STORAGE_KEYS.refreshToken);
  }
  if (cleanupScope === AUTH_SCOPES.ADMIN || cleanupScope === AUTH_SCOPES.ALL) {
    removeStorageKey(AUTH_STORAGE_KEYS.adminAccessToken);
    removeStorageKey(AUTH_STORAGE_KEYS.adminRefreshToken);
  }
}

export function subscribeToAuthSessionEnded(listener) {
  if (typeof listener !== "function" || typeof window === "undefined") return () => {};
  function onWindowEvent(event) {
    listener(event.detail || {});
  }
  window.addEventListener(AUTH_SESSION_ENDED_EVENT, onWindowEvent);
  return () => window.removeEventListener(AUTH_SESSION_ENDED_EVENT, onWindowEvent);
}

export function endAuthSession(reason = "session_expired", { scope = AUTH_SCOPES.ALL } = {}) {
  const cleanupScope = normalizeCleanupScope(scope);
  clearAuthTokens({ scope: cleanupScope });
  if (sessionEndEmittedScopes.has(cleanupScope)) return;
  sessionEndEmittedScopes.add(cleanupScope);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_SESSION_ENDED_EVENT, {
      detail: { reason, scope: cleanupScope },
    }));
  }
}

export function shouldSkipAuthRefresh(url) {
  const pathname = getPathname(url);
  return AUTH_REFRESH_EXCLUDED_PATHS.some((path) => (
    pathname === path
    || pathname.startsWith(`${path}/`)
    || pathname.endsWith(path)
    || pathname.endsWith(`${path}/`)
  ));
}

export async function refreshAuthSession({ baseURL, scope = AUTH_SCOPES.DEFAULT } = {}) {
  const normalizedScope = normalizeScope(scope);
  if (refreshPromises[normalizedScope]) return refreshPromises[normalizedScope];

  const refreshToken = getRefreshToken({ scope: normalizedScope });
  if (!refreshToken) {
    endAuthSession("missing_refresh_token", { scope: normalizedScope });
    return Promise.reject(new Error("missing_refresh_token"));
  }

  refreshPromises[normalizedScope] = axios.post(joinUrl(baseURL, AUTH_REFRESH_PATH), {
    refresh_token: refreshToken,
  }, {
    headers: { "Content-Type": "application/json" },
  })
    .then(({ data }) => {
      if (!isValidTokenResponse(data)) {
        throw new Error("invalid_refresh_response");
      }
      saveAuthTokens(data, { scope: normalizedScope });
      return data.access_token;
    })
    .catch((error) => {
      endAuthSession("refresh_failed", { scope: normalizedScope });
      throw error;
    })
    .finally(() => {
      refreshPromises[normalizedScope] = null;
    });

  return refreshPromises[normalizedScope];
}

export async function handleAuthResponseError(error, { client, baseURL, scope = AUTH_SCOPES.DEFAULT, resolveScope } = {}) {
  const originalRequest = error?.config;
  const status = error?.response?.status;
  const requestUrl = getRequestUrl(originalRequest);

  if (status !== 401 || !originalRequest || shouldSkipAuthRefresh(requestUrl)) {
    return Promise.reject(error);
  }

  const requestScope = normalizeScope(
    originalRequest._authScope || (typeof resolveScope === "function" ? resolveScope().scope : scope),
  );

  if (originalRequest._authRetry) {
    endAuthSession("retry_unauthorized", { scope: requestScope });
    return Promise.reject(error);
  }

  originalRequest._authRetry = true;
  originalRequest._authScope = requestScope;

  try {
    const newAccessToken = await refreshAuthSession({
      baseURL: getRequestBaseURL(originalRequest, baseURL),
      scope: requestScope,
    });
    if (getCallerSignal(originalRequest)?.aborted) {
      return Promise.reject(createRequestAbortedError(originalRequest));
    }
    setAuthorizationHeader(originalRequest, newAccessToken);
    return client(originalRequest);
  } catch (refreshError) {
    return Promise.reject(refreshError);
  }
}

export function getAuthRefreshPromiseForTest(scope = AUTH_SCOPES.DEFAULT) {
  return refreshPromises[normalizeScope(scope)];
}

export function resetAuthSessionStateForTest() {
  refreshPromises[AUTH_SCOPES.DEFAULT] = null;
  refreshPromises[AUTH_SCOPES.ADMIN] = null;
  sessionEndEmittedScopes.clear();
}
