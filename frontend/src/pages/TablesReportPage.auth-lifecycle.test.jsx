import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, API_BASE_URL } from "../api/client";
import {
  AUTH_STORAGE_KEYS,
  resetAuthSessionStateForTest,
} from "../auth/session";
import TablesReportPage from "./TablesReportPage";

vi.mock("../components/ReportDateRangePicker", () => ({
  default: ({ buttonAriaLabel }) => (
    <button type="button" aria-label={buttonAriaLabel}>Период</button>
  ),
}));

vi.mock("../utils/excel", () => ({ exportToExcel: vi.fn() }));

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
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

const filterMetadata = {
  waiters: [],
  cashiers: [],
  payment_methods: [],
  places: [],
  place_filter_supported: false,
};

describe("TablesReportPage auth lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthSessionStateForTest();
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "expired-access");
    localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, "refresh-before-rotation");
  });

  it("survives StrictMode cleanup while a 401 refresh retries the current Tables request", async () => {
    const refreshGate = deferred();
    const networkTrace = [];
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const apiGetSpy = vi.spyOn(api, "get");
    const refreshSpy = vi.spyOn(axios, "post").mockImplementation((url, body) => {
      networkTrace.push({ kind: "refresh", url: String(url), body });
      return refreshGate.promise;
    });
    const fetchMock = vi.fn((requestUrl, options = {}) => {
      const url = new URL(String(requestUrl));
      const authorization = options.headers?.get("Authorization") || "";

      if (url.pathname.endsWith("/reports/tables/filters")) {
        networkTrace.push({ kind: "metadata", status: 200, authorization });
        return Promise.resolve(jsonResponse(filterMetadata));
      }

      if (url.pathname.endsWith("/reports/tables")) {
        if (authorization === "Bearer expired-access") {
          networkTrace.push({ kind: "tables", status: 401, authorization });
          return Promise.resolve(jsonResponse({ detail: "expired" }, 401));
        }
        if (authorization === "Bearer refreshed-access") {
          networkTrace.push({ kind: "tables", status: 200, authorization, body: [] });
          return Promise.resolve(jsonResponse([]));
        }
      }

      return Promise.reject(new Error(`Unexpected request: ${requestUrl}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <TablesReportPage />
      </StrictMode>,
    );

    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1));

    const pageTablesCalls = apiGetSpy.mock.calls.filter(([path]) => path === "/reports/tables");
    const pageMetadataCalls = apiGetSpy.mock.calls.filter(([path]) => path === "/reports/tables/filters");
    expect(pageTablesCalls).toHaveLength(2);
    expect(pageMetadataCalls).toHaveLength(2);
    expect(pageTablesCalls.filter(([, config]) => config.signal.aborted)).toHaveLength(1);
    expect(pageMetadataCalls.filter(([, config]) => config.signal.aborted)).toHaveLength(1);
    expect(abortSpy).toHaveBeenCalled();

    expect(refreshSpy).toHaveBeenCalledWith(
      `${API_BASE_URL}/auth/refresh`,
      { refresh_token: "refresh-before-rotation" },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );

    act(() => {
      refreshGate.resolve({
        data: {
          access_token: "refreshed-access",
          refresh_token: "refresh-after-rotation",
        },
      });
    });

    expect(await screen.findByRole("heading", { name: "Отчёт по столам" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Период отчёта по столам" })).toBeInTheDocument();
    expect(document.querySelector(".tables-report-page .tables-filter-toggle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скачать Excel" })).toBeInTheDocument();
    expect(await screen.findByText("Столы не найдены")).toBeInTheDocument();
    expect(screen.queryByText("Не удалось загрузить отчёт по столам.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const refreshCalls = networkTrace.filter(({ kind }) => kind === "refresh");
    const metadataSuccesses = networkTrace.filter(({ kind, status }) => kind === "metadata" && status === 200);
    const tablesUnauthorized = networkTrace.filter(({ kind, status }) => kind === "tables" && status === 401);
    const tablesSuccesses = networkTrace.filter(({ kind, status }) => kind === "tables" && status === 200);
    expect(refreshCalls).toHaveLength(1);
    expect(metadataSuccesses.length).toBeGreaterThanOrEqual(1);
    expect(tablesUnauthorized.length).toBeGreaterThanOrEqual(1);
    expect(tablesSuccesses).toEqual([
      {
        kind: "tables",
        status: 200,
        authorization: "Bearer refreshed-access",
        body: [],
      },
    ]);
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("refreshed-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("refresh-after-rotation");
  });
});
