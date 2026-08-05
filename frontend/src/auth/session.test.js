import { waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminApi,
  adminLogin,
  adminLogout,
  isAdminAuthenticated,
} from "../admin/api";
import { api, API_BASE_URL, logout } from "../api/client";
import {
  AUTH_SCOPES,
  AUTH_SESSION_ENDED_EVENT,
  AUTH_STORAGE_KEYS,
  getAccessToken,
  getAuthRefreshPromiseForTest,
  resetAuthSessionStateForTest,
  resolveAdminAuthSession,
  saveAuthTokens,
  subscribeToAuthSessionEnded,
} from "./session";

function getHeader(headers, key) {
  return headers?.get?.(key) || headers?.[key] || headers?.[key.toLowerCase()];
}

function parseBody(data) {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function resolveResponse(config, data = { ok: true }) {
  return Promise.resolve({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  });
}

function rejectStatus(config, status) {
  return Promise.reject({
    config,
    message: `Request failed with status code ${status}`,
    response: { status, data: { detail: `status ${status}` } },
  });
}

function rejectNetwork(config) {
  return Promise.reject({
    config,
    message: "Network Error",
    request: {},
  });
}

function rejectAbort(config) {
  return Promise.reject({
    config,
    name: "AbortError",
    message: "The operation was aborted",
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function setDefaultTokens(access = "default-access", refresh = "default-refresh") {
  localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, access);
  localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, refresh);
}

function setAdminTokens(access = "admin-access", refresh = "admin-refresh") {
  localStorage.setItem(AUTH_STORAGE_KEYS.adminAccessToken, access);
  localStorage.setItem(AUTH_STORAGE_KEYS.adminRefreshToken, refresh);
}

function mockRefreshByToken(tokenMap) {
  return vi.spyOn(axios, "post").mockImplementation((url, body) => {
    const response = tokenMap[body?.refresh_token];
    if (!response) return Promise.reject({ response: { status: 401 } });
    if (typeof response.then === "function") return response;
    return Promise.resolve({ data: response });
  });
}

function mockRefreshSuccess(accessToken = "new-default-access", refreshToken = "new-default-refresh") {
  return vi.spyOn(axios, "post").mockResolvedValue({
    data: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
    },
  });
}

function retryingAdapter(retryData = { retried: true }) {
  return vi.fn((config) => (
    config._authRetry ? resolveResponse(config, retryData) : rejectStatus(config, 401)
  ));
}

describe("auth session and axios clients", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetAuthSessionStateForTest();
    api.defaults.adapter = undefined;
    adminApi.defaults.adapter = undefined;
  });

  it("default client uses only default access token", async () => {
    setDefaultTokens("default-access-a", "default-refresh-a");
    setAdminTokens("admin-access-a", "admin-refresh-a");
    const adapter = vi.fn((config) => resolveResponse(config));
    api.defaults.adapter = adapter;

    await api.get("/protected");

    expect(adapter.mock.calls[0][0]._authScope).toBe(AUTH_SCOPES.DEFAULT);
    expect(getHeader(adapter.mock.calls[0][0].headers, "Authorization")).toBe("Bearer default-access-a");
  });

  it("does not add Authorization header when default access token is missing", async () => {
    const adapter = vi.fn((config) => resolveResponse(config));
    api.defaults.adapter = adapter;

    await api.get("/public");

    expect(getHeader(adapter.mock.calls[0][0].headers, "Authorization")).toBeUndefined();
  });

  it("does not authenticate the admin application with default tokens", () => {
    setDefaultTokens("default-access-a", "default-refresh-a");

    expect(isAdminAuthenticated()).toBe(false);
    expect(resolveAdminAuthSession()).toEqual({
      scope: AUTH_SCOPES.ADMIN,
      accessToken: "",
      refreshToken: "",
    });
  });

  it("authenticates the admin application only with an admin access token", () => {
    setDefaultTokens("default-access-a", "default-refresh-a");
    setAdminTokens("admin-access-a", "admin-refresh-a");

    expect(isAdminAuthenticated()).toBe(true);
  });

  it("adminApi with admin tokens uses admin access token", async () => {
    setDefaultTokens("default-access-a", "default-refresh-a");
    setAdminTokens("admin-access-a", "admin-refresh-a");
    const adapter = vi.fn((config) => resolveResponse(config));
    adminApi.defaults.adapter = adapter;

    await adminApi.get("/admin-reports/dashboard-kpis");

    expect(adapter.mock.calls[0][0]._authScope).toBe(AUTH_SCOPES.ADMIN);
    expect(getHeader(adapter.mock.calls[0][0].headers, "Authorization")).toBe("Bearer admin-access-a");
  });

  it("adminApi without admin tokens never attaches default tokens", async () => {
    setDefaultTokens("default-access-a", "default-refresh-a");
    const adapter = vi.fn((config) => resolveResponse(config));
    adminApi.defaults.adapter = adapter;

    await adminApi.get("/admin-reports/dashboard-kpis");

    expect(resolveAdminAuthSession().scope).toBe(AUTH_SCOPES.ADMIN);
    expect(adapter.mock.calls[0][0]._authScope).toBe(AUTH_SCOPES.ADMIN);
    expect(getHeader(adapter.mock.calls[0][0].headers, "Authorization")).toBeUndefined();
  });

  it("failed admin login does not create an admin or local session", async () => {
    const login = vi.spyOn(adminApi, "post").mockRejectedValue({ response: { status: 401 } });

    await expect(adminLogin("900000000", "invalid-password")).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(login).toHaveBeenCalledTimes(1);
    expect(isAdminAuthenticated()).toBe(false);
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBeNull();
    expect(localStorage.getItem("admin_local_login")).toBeNull();
  });

  it("legacy local admin flag does not authenticate the admin application", () => {
    localStorage.setItem("admin_local_login", "true");

    expect(isAdminAuthenticated()).toBe(false);
  });

  it("admin logout clears only the administrative session", () => {
    setDefaultTokens("default-access-a", "default-refresh-a");
    setAdminTokens("admin-access-a", "admin-refresh-a");

    adminLogout();

    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("default-access-a");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("default-refresh-a");
  });

  it("logout removes default and admin tokens", () => {
    setDefaultTokens();
    setAdminTokens();

    logout();

    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBeNull();
  });

  it("saves refreshed token pairs in the requested scope", () => {
    saveAuthTokens({ access_token: "access-b", refresh_token: "refresh-b" }, { scope: AUTH_SCOPES.ADMIN });

    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBe("access-b");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBe("refresh-b");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBeNull();
  });

  it("default refresh does not write admin tokens", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    setAdminTokens("old-admin-access", "old-admin-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    api.defaults.adapter = retryingAdapter();

    await api.get("/resource");

    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("new-default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("new-default-refresh");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBe("old-admin-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBe("old-admin-refresh");
  });

  it("admin refresh does not write default tokens", async () => {
    setDefaultTokens("old-default-access", "old-default-refresh");
    setAdminTokens("old-admin-access", "admin-refresh");
    mockRefreshByToken({
      "admin-refresh": { access_token: "new-admin-access", refresh_token: "new-admin-refresh" },
    });
    adminApi.defaults.adapter = retryingAdapter();

    await adminApi.get("/admin-resource");

    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBe("new-admin-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBe("new-admin-refresh");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("old-default-refresh");
  });

  it("one default 401 starts one default refresh and retries the original request", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const adapter = retryingAdapter({ retried: true });
    api.defaults.adapter = adapter;

    const response = await api.get("/resource");

    expect(response.data).toEqual({ retried: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(`${API_BASE_URL}/auth/refresh`, { refresh_token: "default-refresh" }, expect.any(Object));
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(adapter.mock.calls[1][0]._authScope).toBe(AUTH_SCOPES.DEFAULT);
    expect(getHeader(adapter.mock.calls[1][0].headers, "Authorization")).toBe("Bearer new-default-access");
  });

  it("five default 401 responses create one default refresh", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const pendingDefaultRefresh = deferred();
    const refresh = mockRefreshByToken({ "default-refresh": pendingDefaultRefresh.promise });
    const adapter = retryingAdapter();
    api.defaults.adapter = adapter;

    const requests = Array.from({ length: 5 }, (_, index) => api.get(`/resource-${index}`));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).not.toBeNull();
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.ADMIN)).toBeNull();

    pendingDefaultRefresh.resolve({ data: { access_token: "new-default-access", refresh_token: "new-default-refresh" } });
    await Promise.all(requests);

    expect(adapter).toHaveBeenCalledTimes(10);
    expect(adapter.mock.calls.slice(5).every(([config]) => config._authScope === AUTH_SCOPES.DEFAULT)).toBe(true);
    expect(adapter.mock.calls.slice(5).every(([config]) => getHeader(config.headers, "Authorization") === "Bearer new-default-access")).toBe(true);
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).toBeNull();
  });

  it("five admin 401 responses create one admin refresh", async () => {
    setAdminTokens("old-admin-access", "admin-refresh");
    const pendingAdminRefresh = deferred();
    const refresh = mockRefreshByToken({ "admin-refresh": pendingAdminRefresh.promise });
    const adapter = retryingAdapter();
    adminApi.defaults.adapter = adapter;

    const requests = Array.from({ length: 5 }, (_, index) => adminApi.get(`/admin-resource-${index}`));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.ADMIN)).not.toBeNull();
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).toBeNull();

    pendingAdminRefresh.resolve({ data: { access_token: "new-admin-access", refresh_token: "new-admin-refresh" } });
    await Promise.all(requests);

    expect(adapter).toHaveBeenCalledTimes(10);
    expect(adapter.mock.calls.slice(5).every(([config]) => config._authScope === AUTH_SCOPES.ADMIN)).toBe(true);
    expect(adapter.mock.calls.slice(5).every(([config]) => getHeader(config.headers, "Authorization") === "Bearer new-admin-access")).toBe(true);
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.ADMIN)).toBeNull();
  });

  it("simultaneous default and admin 401 responses create independent refresh requests", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    setAdminTokens("old-admin-access", "admin-refresh");
    const pendingDefaultRefresh = deferred();
    const pendingAdminRefresh = deferred();
    const refresh = mockRefreshByToken({
      "default-refresh": pendingDefaultRefresh.promise,
      "admin-refresh": pendingAdminRefresh.promise,
    });
    const apiAdapter = retryingAdapter({ client: "default" });
    const adminAdapter = retryingAdapter({ client: "admin" });
    api.defaults.adapter = apiAdapter;
    adminApi.defaults.adapter = adminAdapter;

    const defaultRequests = Array.from({ length: 5 }, (_, index) => api.get(`/resource-${index}`));
    const adminRequests = Array.from({ length: 5 }, (_, index) => adminApi.get(`/admin-resource-${index}`));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).not.toBeNull();
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.ADMIN)).not.toBeNull();

    pendingAdminRefresh.resolve({ data: { access_token: "new-admin-access", refresh_token: "new-admin-refresh" } });
    pendingDefaultRefresh.resolve({ data: { access_token: "new-default-access", refresh_token: "new-default-refresh" } });
    await Promise.all([...defaultRequests, ...adminRequests]);

    expect(apiAdapter.mock.calls.slice(5).every(([config]) => getHeader(config.headers, "Authorization") === "Bearer new-default-access")).toBe(true);
    expect(adminAdapter.mock.calls.slice(5).every(([config]) => getHeader(config.headers, "Authorization") === "Bearer new-admin-access")).toBe(true);
    expect(apiAdapter.mock.calls.slice(5).some(([config]) => getHeader(config.headers, "Authorization") === "Bearer new-admin-access")).toBe(false);
    expect(adminAdapter.mock.calls.slice(5).some(([config]) => getHeader(config.headers, "Authorization") === "Bearer new-default-access")).toBe(false);
  });

  it("adminApi never refreshes through default scope when admin tokens are absent", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = vi.spyOn(axios, "post");
    adminApi.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await expect(adminApi.get("/admin-resource")).rejects.toThrow("missing_refresh_token");

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("default-refresh");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBeNull();
  });

  it("does not refresh again when the retried request also returns 401", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = mockRefreshSuccess("new-default-access", "new-default-refresh");
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await expect(api.get("/resource")).rejects.toMatchObject({ response: { status: 401 } });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBeNull();
  });

  it("ends the default session without refresh when default refresh token is missing", async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "old-default-access");
    setAdminTokens("admin-access", "admin-refresh");
    const refresh = vi.spyOn(axios, "post");
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await expect(api.get("/resource")).rejects.toThrow("missing_refresh_token");

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBe("admin-access");
  });

  it.each([400, 401, 403])("clears only default tokens when default refresh fails with %s", async (status) => {
    setDefaultTokens("old-default-access", "default-refresh");
    setAdminTokens("admin-access", "admin-refresh");
    vi.spyOn(axios, "post").mockRejectedValue({ response: { status } });
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await expect(api.get("/resource")).rejects.toMatchObject({ response: { status } });

    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBe("admin-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBe("admin-refresh");
  });

  it.each([400, 401, 403])("clears only admin tokens when admin refresh fails with %s", async (status) => {
    setDefaultTokens("default-access", "default-refresh");
    setAdminTokens("old-admin-access", "admin-refresh");
    vi.spyOn(axios, "post").mockRejectedValue({ response: { status } });
    adminApi.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await expect(adminApi.get("/admin-resource")).rejects.toMatchObject({ response: { status } });

    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("default-refresh");
  });

  it("missing admin refresh token clears only admin tokens and preserves default tokens", async () => {
    setDefaultTokens("default-access", "default-refresh");
    localStorage.setItem(AUTH_STORAGE_KEYS.adminAccessToken, "admin-access");
    const refresh = vi.spyOn(axios, "post");
    adminApi.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await expect(adminApi.get("/admin-resource")).rejects.toThrow("missing_refresh_token");

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("default-refresh");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminRefreshToken)).toBeNull();
  });

  it("clears the scoped refresh promise after success and allows a later refresh", async () => {
    setDefaultTokens("old-default-access", "default-refresh-one");
    const refresh = mockRefreshByToken({
      "default-refresh-one": { access_token: "default-access-two", refresh_token: "default-refresh-two" },
      "default-refresh-two": { access_token: "default-access-three", refresh_token: "default-refresh-three" },
    });
    api.defaults.adapter = retryingAdapter();

    await api.get("/resource-one");
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).toBeNull();
    await api.get("/resource-two");

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("default-access-three");
  });

  it("clears the scoped refresh promise after refresh failure", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const pendingRefresh = deferred();
    vi.spyOn(axios, "post").mockReturnValue(pendingRefresh.promise);
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    const request = api.get("/resource");
    await waitFor(() => expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).not.toBeNull());
    pendingRefresh.reject({ response: { status: 401 } });
    await expect(request).rejects.toMatchObject({ response: { status: 401 } });

    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).toBeNull();
  });

  it("clears the session when refresh response is invalid", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    vi.spyOn(axios, "post").mockResolvedValue({ data: { access_token: "new-default-access" } });
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await expect(api.get("/resource")).rejects.toThrow("invalid_refresh_response");

    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBeNull();
  });

  it.each(["/auth/login", "/auth/pin-login", "/auth/refresh?source=retry"])("does not refresh auth endpoint %s", async (url) => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = vi.spyOn(axios, "post");
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await expect(api.post(url, {})).rejects.toMatchObject({ response: { status: 401 } });

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-default-access");
  });

  it.each([403, 404, 409, 422, 500])("does not refresh status %s", async (status) => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = vi.spyOn(axios, "post");
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, status));

    await expect(api.get("/resource")).rejects.toMatchObject({ response: { status } });

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("default-refresh");
  });

  it("does not refresh or logout on network errors without HTTP status", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = vi.spyOn(axios, "post");
    api.defaults.adapter = vi.fn((config) => rejectNetwork(config));

    await expect(api.get("/resource")).rejects.toMatchObject({ message: "Network Error" });

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("default-refresh");
  });

  it("does not refresh or logout on AbortError", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = vi.spyOn(axios, "post");
    api.defaults.adapter = vi.fn((config) => rejectAbort(config));

    await expect(api.get("/resource")).rejects.toMatchObject({ name: "AbortError" });

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("default-refresh");
  });

  it("preserves POST JSON body, custom headers, and Idempotency-Key on retry", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const adapter = retryingAdapter();
    api.defaults.adapter = adapter;
    const body = { amount: 123, comment: "retry" };

    await api.post("/resource", body, {
      headers: {
        "X-Custom": "custom-value",
        "Idempotency-Key": "idem-1",
      },
    });

    const retryConfig = adapter.mock.calls[1][0];
    expect(parseBody(retryConfig.data)).toEqual(body);
    expect(getHeader(retryConfig.headers, "X-Custom")).toBe("custom-value");
    expect(getHeader(retryConfig.headers, "Idempotency-Key")).toBe("idem-1");
    expect(getHeader(retryConfig.headers, "Authorization")).toBe("Bearer new-default-access");
  });

  it("preserves PATCH JSON body on retry", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const adapter = retryingAdapter();
    api.defaults.adapter = adapter;
    const body = { status: "updated" };

    await api.patch("/resource/1", body);

    expect(parseBody(adapter.mock.calls[1][0].data)).toEqual(body);
    expect(getHeader(adapter.mock.calls[1][0].headers, "Authorization")).toBe("Bearer new-default-access");
  });

  it("preserves DELETE JSON body on retry", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const adapter = retryingAdapter();
    api.defaults.adapter = adapter;
    const body = { reason: "duplicate" };

    await api.delete("/resource/1", { data: body });

    expect(parseBody(adapter.mock.calls[1][0].data)).toEqual(body);
  });

  it("preserves query parameters on retry", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const adapter = retryingAdapter();
    api.defaults.adapter = adapter;

    await api.get("/resource", { params: { page: 2, q: "cash" } });

    expect(adapter.mock.calls[1][0].params).toEqual({ page: 2, q: "cash" });
  });

  it("preserves FormData body on retry", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const adapter = retryingAdapter();
    api.defaults.adapter = adapter;
    const formData = new FormData();
    formData.append("file", new Blob(["data"], { type: "text/plain" }), "file.txt");

    await api.post("/upload", formData);

    expect(adapter.mock.calls[1][0].data).toBe(formData);
    expect(getHeader(adapter.mock.calls[1][0].headers, "Authorization")).toBe("Bearer new-default-access");
  });

  it("session-ended event contains scope and fires once per scoped failure", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    vi.spyOn(axios, "post").mockRejectedValue({ response: { status: 401 } });
    const events = [];
    window.addEventListener(AUTH_SESSION_ENDED_EVENT, (event) => events.push(event.detail));
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    await Promise.allSettled([api.get("/one"), api.get("/two"), api.get("/three")]);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ reason: "refresh_failed", scope: AUTH_SCOPES.DEFAULT });
  });

  it("subscribe cleanup removes the session-ended listener", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAuthSessionEnded(listener);

    unsubscribe();
    window.dispatchEvent(new CustomEvent(AUTH_SESSION_ENDED_EVENT, {
      detail: { reason: "refresh_failed", scope: AUTH_SCOPES.DEFAULT },
    }));

    expect(listener).not.toHaveBeenCalled();
  });

  it("returns access tokens strictly by scope", () => {
    setDefaultTokens("default-access", "default-refresh");
    setAdminTokens("admin-access", "admin-refresh");

    expect(getAccessToken({ scope: AUTH_SCOPES.DEFAULT })).toBe("default-access");
    expect(getAccessToken({ scope: AUTH_SCOPES.ADMIN })).toBe("admin-access");
  });
});
