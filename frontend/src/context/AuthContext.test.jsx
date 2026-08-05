import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import {
  AUTH_SCOPES,
  AUTH_SESSION_ENDED_EVENT,
  AUTH_STORAGE_KEYS,
  resetAuthSessionStateForTest,
} from "../auth/session";
import { getRoleHomePath } from "../utils/permissions";
import { AuthProvider, useAuth } from "./AuthContext";

const ownerUser = {
  id: "owner",
  email: "owner@marjon.test",
  role_slugs: ["owner"],
  is_active: true,
  is_superadmin: false,
};

function resolveResponse(config, data = ownerUser) {
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user">{auth.user ? "present" : "missing"}</span>
      <span data-testid="role">{auth.role || "none"}</span>
      <span data-testid="session-expired">{String(Boolean(auth.sessionExpired))}</span>
      <button type="button" onClick={auth.logout}>logout</button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetAuthSessionStateForTest();
    api.defaults.adapter = undefined;
  });

  it("handles a session without stored tokens", async () => {
    const adapter = vi.fn((config) => resolveResponse(config));
    api.defaults.adapter = adapter;

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("user")).toHaveTextContent("missing");
    expect(screen.getByTestId("role")).toHaveTextContent("none");
    expect(adapter).not.toHaveBeenCalled();
  });

  it("restores the user through /auth/me when an access token exists", async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "access-a");
    api.defaults.adapter = vi.fn((config) => resolveResponse(config, ownerUser));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("authenticated")).toHaveTextContent("true"));
    expect(screen.getByTestId("user")).toHaveTextContent("present");
    expect(screen.getByTestId("role")).toHaveTextContent("owner");
  });

  it("uses refresh flow when /auth/me returns 401", async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "old-access");
    localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, "old-refresh");
    vi.spyOn(axios, "post").mockResolvedValue({
      data: { access_token: "new-access", refresh_token: "new-refresh" },
    });
    api.defaults.adapter = vi.fn((config) => (
      config._authRetry ? resolveResponse(config, ownerUser) : rejectStatus(config, 401)
    ));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("authenticated")).toHaveTextContent("true"));
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe("new-access");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBe("new-refresh");
  });

  it("clears user state when refresh after /auth/me fails", async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "old-access");
    localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, "old-refresh");
    vi.spyOn(axios, "post").mockRejectedValue({ response: { status: 401 } });
    api.defaults.adapter = vi.fn((config) => rejectStatus(config, 401));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("user")).toHaveTextContent("missing");
    expect(screen.getByTestId("session-expired")).toHaveTextContent("true");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
  });

  it("keeps initial loading active while /auth/me is pending", async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "access-a");
    const profile = deferred();
    api.defaults.adapter = vi.fn((config) => profile.promise.then(() => resolveResponse(config, ownerUser)));

    renderAuth();

    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(screen.getByTestId("user")).toHaveTextContent("missing");

    profile.resolve();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("present");
  });

  it("logout clears tokens and user state", async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "access-a");
    localStorage.setItem(AUTH_STORAGE_KEYS.refreshToken, "refresh-a");
    api.defaults.adapter = vi.fn((config) => resolveResponse(config, ownerUser));

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("present"));

    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("missing"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.refreshToken)).toBeNull();
  });

  it("does not clear the main user state for an admin session-ended event", async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "access-a");
    api.defaults.adapter = vi.fn((config) => resolveResponse(config, ownerUser));

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("present"));

    window.dispatchEvent(new CustomEvent(AUTH_SESSION_ENDED_EVENT, {
      detail: { reason: "refresh_failed", scope: AUTH_SCOPES.ADMIN },
    }));

    expect(screen.getByTestId("user")).toHaveTextContent("present");
    expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
  });

  it("clears the main user state for a default session-ended event", async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "access-a");
    api.defaults.adapter = vi.fn((config) => resolveResponse(config, ownerUser));

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("present"));

    window.dispatchEvent(new CustomEvent(AUTH_SESSION_ENDED_EVENT, {
      detail: { reason: "refresh_failed", scope: AUTH_SCOPES.DEFAULT },
    }));

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("missing"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("session-expired")).toHaveTextContent("true");
  });

  it("does not turn an unknown role into owner and keeps a safe role home", async () => {
    const unknownRoleUser = { ...ownerUser, role_slugs: ["auditor"] };
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, "access-a");
    api.defaults.adapter = vi.fn((config) => resolveResponse(config, unknownRoleUser));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId("role")).toHaveTextContent("auditor"));
    expect(screen.getByTestId("role")).not.toHaveTextContent("owner");
    expect(getRoleHomePath(unknownRoleUser)).toBe("/login");
  });
});
