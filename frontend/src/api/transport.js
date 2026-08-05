import axios from "axios";

export const API_ERROR_CODES = {
  HTTP_ERROR: "HTTP_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  ABORTED: "ABORTED",
  PARSE_ERROR: "PARSE_ERROR",
};

export const DEFAULT_HTTP_TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = options.name || "ApiError";
    this.code = options.code || API_ERROR_CODES.NETWORK_ERROR;
    this.status = options.status;
    this.data = options.data;
    this.detail = options.detail;
    this.url = options.url;
    this.method = options.method;
    this.isRetry = Boolean(options.isRetry);
    this.isTimeout = Boolean(options.isTimeout);
    this.isAborted = Boolean(options.isAborted);
    this.isNetworkError = Boolean(options.isNetworkError);
    this.response = options.response;
    this.config = options.config;
    if (options.request !== undefined) this.request = options.request;
    if (options.cause && !this.cause) this.cause = options.cause;
    if (this.isAborted) this.__CANCEL__ = true;
  }
}

function isFormDataBody(data) {
  return typeof FormData !== "undefined" && data instanceof FormData;
}

function isAbsoluteUrl(url) {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(String(url || ""));
}

function getRequestUrl(config) {
  const url = axios.getUri(config);
  if (isAbsoluteUrl(url) || !config?.baseURL) return url;
  return `${String(config.baseURL).replace(/\/+$/, "")}/${String(url).replace(/^\/+/, "")}`;
}

function normalizeMethod(method) {
  return String(method || "get").toUpperCase();
}

function normalizeHeaders(headers) {
  if (!headers) return {};
  const source = typeof headers.toJSON === "function" ? headers.toJSON() : headers;
  return Object.entries(source).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === false) return acc;
    acc[key] = Array.isArray(value) ? value.join(", ") : String(value);
    return acc;
  }, {});
}

function headerValue(headers, name) {
  const needle = name.toLowerCase();
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === needle) return value;
  }
  return "";
}

function removeHeader(headers, name) {
  const needle = name.toLowerCase();
  for (const key of Array.from(headers.keys())) {
    if (key.toLowerCase() === needle) headers.delete(key);
  }
}

function headersToObject(headers) {
  const output = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function isJsonContentType(contentType) {
  return /\bjson\b/i.test(contentType || "");
}

function detailFromData(data) {
  if (data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "detail")) {
    return data.detail;
  }
  return undefined;
}

function messageFromHttpError(data, status, statusText) {
  const detail = detailFromData(data);
  if (typeof detail === "string" && detail.trim()) return detail;
  if (typeof data === "string" && data.trim()) return data.trim();
  return statusText || `Request failed with status code ${status}`;
}

function createResponse({ data, response, config }) {
  const headers = headersToObject(response.headers);
  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers,
    config,
    request: null,
  };
}

async function parseResponseBody(response, config, requestUrl, method) {
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 204 || response.status === 205) return "";

  const text = await response.text();
  if (!text) return "";
  if (!isJsonContentType(contentType)) return text;

  try {
    return JSON.parse(text);
  } catch (error) {
    if (!response.ok) return text;
    throw new ApiError("Failed to parse response JSON", {
      code: API_ERROR_CODES.PARSE_ERROR,
      status: response.status,
      data: text,
      detail: text,
      url: requestUrl,
      method,
      isRetry: Boolean(config?._authRetry),
      cause: error,
      response: createResponse({ data: text, response, config }),
      config,
    });
  }
}

function resolveTimeout(config, defaultTimeout) {
  const timeout = Number(config?.timeout);
  if (Number.isFinite(timeout)) return Math.max(0, timeout);
  return defaultTimeout;
}

function createRequestSignal(externalSignal, timeoutMs) {
  if (typeof AbortController === "undefined") {
    return {
      signal: externalSignal,
      abortReason: () => externalSignal?.aborted ? "caller" : "",
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  let reason = "";
  let timeoutId = null;

  function abort(nextReason) {
    if (controller.signal.aborted) return;
    reason = nextReason;
    controller.abort();
  }

  function onCallerAbort() {
    abort("caller");
  }

  if (externalSignal?.aborted) {
    abort("caller");
  } else if (externalSignal) {
    externalSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => abort("timeout"), timeoutMs);
  }

  return {
    signal: controller.signal,
    abortReason: () => reason,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener("abort", onCallerAbort);
    },
  };
}

function createAbortError({ config, requestUrl, method, cause }) {
  return new ApiError("Request was aborted", {
    name: "AbortError",
    code: API_ERROR_CODES.ABORTED,
    url: requestUrl,
    method,
    isRetry: Boolean(config?._authRetry),
    isAborted: true,
    cause,
    config,
    request: null,
  });
}

function createTimeoutError({ config, requestUrl, method, cause }) {
  return new ApiError("Request timed out", {
    name: "TimeoutError",
    code: API_ERROR_CODES.TIMEOUT,
    url: requestUrl,
    method,
    isRetry: Boolean(config?._authRetry),
    isTimeout: true,
    cause,
    config,
    request: null,
  });
}

function createNetworkError({ config, requestUrl, method, cause }) {
  return new ApiError(cause?.message || "Network Error", {
    code: API_ERROR_CODES.NETWORK_ERROR,
    url: requestUrl,
    method,
    isRetry: Boolean(config?._authRetry),
    isNetworkError: true,
    cause,
    config,
    request: null,
  });
}

function shouldSendBody(method, data) {
  return data !== undefined && data !== null && method !== "GET" && method !== "HEAD";
}

export function createFetchAdapter({ defaultTimeout = DEFAULT_HTTP_TIMEOUT_MS } = {}) {
  return async function fetchAdapter(config = {}) {
    const method = normalizeMethod(config.method);
    const requestUrl = getRequestUrl(config);
    const headers = new Headers(normalizeHeaders(config.headers));
    const timeoutMs = resolveTimeout(config, defaultTimeout);
    const callerSignal = config._callerSignal || config.signal;
    const requestSignal = createRequestSignal(callerSignal, timeoutMs);

    if (isFormDataBody(config.data) && headerValue(headers, "content-type")) {
      removeHeader(headers, "content-type");
    }

    if (requestSignal.signal?.aborted && requestSignal.abortReason() === "caller") {
      requestSignal.cleanup();
      throw createAbortError({ config, requestUrl, method });
    }

    const fetchOptions = {
      method,
      headers,
      signal: requestSignal.signal,
    };

    if (shouldSendBody(method, config.data)) {
      fetchOptions.body = config.data;
    }

    try {
      const response = await fetch(requestUrl, fetchOptions);
      const data = await parseResponseBody(response, config, requestUrl, method);
      const normalizedResponse = createResponse({ data, response, config });

      if (response.ok) return normalizedResponse;

      throw new ApiError(messageFromHttpError(data, response.status, response.statusText), {
        code: API_ERROR_CODES.HTTP_ERROR,
        status: response.status,
        data,
        detail: detailFromData(data),
        url: requestUrl,
        method,
        isRetry: Boolean(config._authRetry),
        response: normalizedResponse,
        config,
        request: null,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (requestSignal.abortReason() === "timeout") {
        throw createTimeoutError({ config, requestUrl, method, cause: error });
      }
      if (requestSignal.abortReason() === "caller" || error?.name === "AbortError") {
        throw createAbortError({ config, requestUrl, method, cause: error });
      }
      throw createNetworkError({ config, requestUrl, method, cause: error });
    } finally {
      requestSignal.cleanup();
    }
  };
}
