import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi, ADMIN_API_BASE_URL } from "../admin/api";
import {
  AUTH_SCOPES,
  AUTH_STORAGE_KEYS,
  getAuthRefreshPromiseForTest,
  resetAuthSessionStateForTest,
} from "../auth/session";
import { api, API_BASE_URL } from "./client";
import {
  API_ERROR_CODES,
  createFetchAdapter,
  DEFAULT_HTTP_TIMEOUT_MS,
} from "./transport";

const apiTransportAdapter = api.defaults.adapter;
const adminTransportAdapter = adminApi.defaults.adapter;

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    statusText: init.statusText || "",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function textResponse(text, init = {}) {
  return new Response(text, {
    status: init.status || 200,
    statusText: init.statusText || "",
    headers: { "Content-Type": "text/plain", ...(init.headers || {}) },
  });
}

function emptyResponse(init = {}) {
  return new Response(null, {
    status: init.status || 200,
    statusText: init.statusText || "",
    headers: init.headers || {},
  });
}

function getFetchHeader(fetchMock, callIndex, key) {
  return fetchMock.mock.calls[callIndex][1].headers.get(key);
}

function parseBody(body) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
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

function mockAbortableFetch() {
  return vi.fn((url, options = {}) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    options.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  }));
}

describe("fetch transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
    resetAuthSessionStateForTest();
    api.defaults.adapter = apiTransportAdapter;
    adminApi.defaults.adapter = adminTransportAdapter;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    api.defaults.adapter = apiTransportAdapter;
    adminApi.defaults.adapter = adminTransportAdapter;
  });

  it("uses a shared 20 second default timeout on both API clients", () => {
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(20000);
    expect(api.defaults.timeout).toBe(DEFAULT_HTTP_TIMEOUT_MS);
    expect(adminApi.defaults.timeout).toBe(DEFAULT_HTTP_TIMEOUT_MS);
  });

  it("returns GET JSON data in the existing axios response shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [1] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.get("/items");

    expect(response.data).toEqual({ items: [1] });
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/items`);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("sends POST JSON and returns 201 JSON data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 7 }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.post("/items", { name: "cash" });

    expect(response.data).toEqual({ id: 7 });
    expect(response.status).toBe(201);
    expect(parseBody(fetchMock.mock.calls[0][1].body)).toEqual({ name: "cash" });
    expect(getFetchHeader(fetchMock, 0, "Content-Type")).toContain("application/json");
  });

  it("sends PATCH JSON without changing the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.patch("/items/7", { status: "active" });

    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(parseBody(fetchMock.mock.calls[0][1].body)).toEqual({ status: "active" });
  });

  it("handles DELETE 204 without parsing JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse({ status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.delete("/items/7");

    expect(response.status).toBe(204);
    expect(response.data).toBe("");
  });

  it("handles a successful empty 200 body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.get("/empty");

    expect(response.status).toBe(200);
    expect(response.data).toBe("");
  });

  it("returns text responses without forcing JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.get("/plain");

    expect(response.data).toBe("ok");
  });

  it("preserves query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/items", { params: { page: 2, q: "cash" } });

    expect(fetchMock.mock.calls[0][0]).toContain("/items?");
    expect(fetchMock.mock.calls[0][0]).toContain("page=2");
    expect(fetchMock.mock.calls[0][0]).toContain("q=cash");
  });

  it("preserves custom headers and Idempotency-Key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/items", { name: "cash" }, {
      headers: {
        "X-Custom": "value",
        "Idempotency-Key": "idem-1",
      },
    });

    expect(getFetchHeader(fetchMock, 0, "X-Custom")).toBe("value");
    expect(getFetchHeader(fetchMock, 0, "Idempotency-Key")).toBe("idem-1");
  });

  it("does not force JSON Content-Type on FormData", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.append("file", new Blob(["data"]), "file.txt");

    await api.post("/upload", formData);

    expect(fetchMock.mock.calls[0][1].body).toBe(formData);
    expect(getFetchHeader(fetchMock, 0, "Content-Type")).toBeNull();
  });

  it("keeps absolute URLs unchanged", async () => {
    const adapter = createFetchAdapter({ defaultTimeout: 0 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await adapter({
      baseURL: API_BASE_URL,
      url: "https://external.marjon.test/rate?currency=USD",
      method: "get",
      headers: {},
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://external.marjon.test/rate?currency=USD");
  });

  it("normalizes HTTP 400 errors and preserves backend body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "bad request" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/bad")).rejects.toMatchObject({
      code: API_ERROR_CODES.HTTP_ERROR,
      status: 400,
      detail: "bad request",
      data: { detail: "bad request" },
      response: { status: 400, data: { detail: "bad request" } },
    });
  });

  it("does not refresh ordinary 403 errors", async () => {
    setDefaultTokens("old-access", "old-refresh");
    const refresh = vi.spyOn(axios, "post");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "forbidden" }, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/forbidden")).rejects.toMatchObject({ status: 403 });

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-access");
  });

  it.each([404, 429, 500])("preserves HTTP status %s and does not retry automatically", async (status) => {
    const refresh = vi.spyOn(axios, "post");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: `status ${status}` }, { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get(`/status-${status}`)).rejects.toMatchObject({
      code: API_ERROR_CODES.HTTP_ERROR,
      status,
      data: { detail: `status ${status}` },
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves 409 detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "conflict" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.post("/items", {})).rejects.toMatchObject({
      status: 409,
      detail: "conflict",
    });
  });

  it("preserves 422 validation error arrays", async () => {
    const detail = [{ loc: ["body", "amount"], msg: "required" }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail }, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await api.post("/items", {});
      throw new Error("expected request to reject");
    } catch (error) {
      expect(error.status).toBe(422);
      expect(error.detail).toEqual(detail);
      expect(error.data).toEqual({ detail });
    }
  });

  it("keeps HTTP status and text when error JSON is invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{bad", {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/broken-error-json")).rejects.toMatchObject({
      code: API_ERROR_CODES.HTTP_ERROR,
      status: 500,
      data: "{bad",
    });
  });

  it("turns invalid success JSON into PARSE_ERROR", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{bad", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/broken-json")).rejects.toMatchObject({
      code: API_ERROR_CODES.PARSE_ERROR,
      status: 200,
      data: "{bad",
    });
  });

  it("turns fetch rejection into NETWORK_ERROR without clearing tokens", async () => {
    setDefaultTokens("old-access", "old-refresh");
    const refresh = vi.spyOn(axios, "post");
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/offline")).rejects.toMatchObject({
      code: API_ERROR_CODES.NETWORK_ERROR,
      isNetworkError: true,
      message: "offline",
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("old-refresh");
  });

  it("times out with TIMEOUT and does not refresh or clear tokens", async () => {
    vi.useFakeTimers();
    setDefaultTokens("old-access", "old-refresh");
    const refresh = vi.spyOn(axios, "post");
    const fetchMock = mockAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);

    const request = api.get("/slow", { timeout: 25 });
    const assertion = expect(request).rejects.toMatchObject({
      code: API_ERROR_CODES.TIMEOUT,
      name: "TimeoutError",
      isTimeout: true,
    });
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-access");
  });

  it("allows request timeout override and clears timeout after success", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/fast", { timeout: 50 });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows timeout 0 to disable the internal timeout", async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    const request = api.get("/long", { timeout: 0 });
    await vi.advanceTimersByTimeAsync(100000);
    pending.resolve(jsonResponse({ ok: true }));

    await expect(request).resolves.toMatchObject({ data: { ok: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears timeout after HTTP errors", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "bad" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/bad", { timeout: 50 })).rejects.toMatchObject({ status: 400 });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("external AbortSignal cancels with ABORTED and does not refresh or clear tokens", async () => {
    setDefaultTokens("old-access", "old-refresh");
    const refresh = vi.spyOn(axios, "post");
    const fetchMock = mockAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const request = api.get("/cancel", { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({
      code: API_ERROR_CODES.ABORTED,
      name: "AbortError",
      isAborted: true,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-access");
  });

  it("handles already aborted signals before fetch", async () => {
    const adapter = createFetchAdapter({ defaultTimeout: 0 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(adapter({
      baseURL: API_BASE_URL,
      url: "/cancelled",
      method: "get",
      headers: {},
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: API_ERROR_CODES.ABORTED,
      name: "AbortError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes external AbortSignal listener after completion", async () => {
    const adapter = createFetchAdapter({ defaultTimeout: 0 });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    await adapter({
      baseURL: API_BASE_URL,
      url: "/items",
      method: "get",
      headers: {},
      signal: controller.signal,
    });

    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("default 401 uses default refresh and retries with the new default token", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/protected");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][1]).toEqual({ refresh_token: "default-refresh" });
    expect(getFetchHeader(fetchMock, 1, "Authorization")).toBe("Bearer new-default-access");
  });

  it("admin 401 uses admin refresh and retries with the new admin token", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    setAdminTokens("old-admin-access", "admin-refresh");
    const refresh = mockRefreshByToken({
      "admin-refresh": { access_token: "new-admin-access", refresh_token: "new-admin-refresh" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.get("/admin-protected");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][1]).toEqual({ refresh_token: "admin-refresh" });
    expect(getFetchHeader(fetchMock, 1, "Authorization")).toBe("Bearer new-admin-access");
  });

  it("adminApi without admin tokens never refreshes through default scope", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = vi.spyOn(axios, "post");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(adminApi.get("/admin-protected")).rejects.toThrow("missing_refresh_token");

    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getFetchHeader(fetchMock, 0, "Authorization")).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("old-default-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("default-refresh");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.adminAccessToken)).toBeNull();
  });

  it("keeps simultaneous default and admin 401 refreshes independent", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    setAdminTokens("old-admin-access", "admin-refresh");
    const pendingDefaultRefresh = deferred();
    const pendingAdminRefresh = deferred();
    const refresh = mockRefreshByToken({
      "default-refresh": pendingDefaultRefresh.promise,
      "admin-refresh": pendingAdminRefresh.promise,
    });
    const fetchMock = vi.fn((url, options) => {
      const auth = options.headers.get("Authorization");
      if (auth === "Bearer old-default-access" || auth === "Bearer old-admin-access") {
        return Promise.resolve(jsonResponse({ detail: "expired" }, { status: 401 }));
      }
      return Promise.resolve(jsonResponse({ auth }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const defaultRequests = Array.from({ length: 5 }, (_, index) => api.get(`/default-${index}`));
    const adminRequests = Array.from({ length: 5 }, (_, index) => adminApi.get(`/admin-${index}`));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).not.toBeNull();
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.ADMIN)).not.toBeNull();

    pendingDefaultRefresh.resolve({ data: { access_token: "new-default-access", refresh_token: "new-default-refresh" } });
    pendingAdminRefresh.resolve({ data: { access_token: "new-admin-access", refresh_token: "new-admin-refresh" } });

    await Promise.all([...defaultRequests, ...adminRequests]);

    const retryAuthHeaders = fetchMock.mock.calls.slice(10).map(([, options]) => options.headers.get("Authorization"));
    expect(retryAuthHeaders.filter((header) => header === "Bearer new-default-access")).toHaveLength(5);
    expect(retryAuthHeaders.filter((header) => header === "Bearer new-admin-access")).toHaveLength(5);
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).toBeNull();
    expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.ADMIN)).toBeNull();
  });

  it("preserves JSON bodies and custom headers after auth retry", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/protected", { amount: 100 }, {
      headers: {
        "X-Custom": "value",
        "Idempotency-Key": "idem-2",
      },
    });

    expect(parseBody(fetchMock.mock.calls[1][1].body)).toEqual({ amount: 100 });
    expect(getFetchHeader(fetchMock, 1, "X-Custom")).toBe("value");
    expect(getFetchHeader(fetchMock, 1, "Idempotency-Key")).toBe("idem-2");
    expect(getFetchHeader(fetchMock, 1, "Authorization")).toBe("Bearer new-default-access");
  });

  it("preserves PATCH body after auth retry", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.patch("/protected/1", { status: "paid" });

    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(parseBody(fetchMock.mock.calls[1][1].body)).toEqual({ status: "paid" });
  });

  it("preserves FormData body after auth retry", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.append("file", new Blob(["data"]), "file.txt");

    await api.post("/upload", formData);

    expect(fetchMock.mock.calls[1][1].body).toBe(formData);
    expect(getFetchHeader(fetchMock, 1, "Content-Type")).toBeNull();
  });

  it("does not run a second refresh after retry returns 401", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = mockRefreshByToken({
      "default-refresh": { access_token: "new-default-access", refresh_token: "new-default-refresh" },
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ detail: "expired" }, { status: 401 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get("/protected")).rejects.toMatchObject({ status: 401 });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
  });

  it.each([
    "/auth/login?next=/",
    "/auth/pin-login/",
    `${API_BASE_URL}/auth/refresh?source=retry`,
  ])("does not refresh auth endpoint %s", async (url) => {
    setDefaultTokens("old-default-access", "default-refresh");
    const refresh = vi.spyOn(axios, "post");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "expired" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.post(url, {})).rejects.toMatchObject({ status: 401 });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not retry if caller aborts while refresh is pending", async () => {
    setDefaultTokens("old-default-access", "default-refresh");
    const pendingRefresh = deferred();
    mockRefreshByToken({ "default-refresh": pendingRefresh.promise });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ detail: "expired" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const request = api.get("/protected", { signal: controller.signal });
    await vi.waitFor(() => expect(getAuthRefreshPromiseForTest(AUTH_SCOPES.DEFAULT)).not.toBeNull());
    controller.abort();
    pendingRefresh.resolve({ data: { access_token: "new-default-access", refresh_token: "new-default-refresh" } });

    await expect(request).rejects.toMatchObject({
      code: API_ERROR_CODES.ABORTED,
      name: "AbortError",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses admin base URL while preserving adminApi public response shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ admin: true }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await adminApi.get("/organizations", { params: { size: 100 } });

    expect(response.data).toEqual({ admin: true });
    expect(fetchMock.mock.calls[0][0]).toContain(`${ADMIN_API_BASE_URL}/organizations`);
    expect(fetchMock.mock.calls[0][0]).toContain("size=100");
  });
});
