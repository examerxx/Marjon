import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const authClient = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  isAuthenticated: vi.fn(() => false),
  login: vi.fn(),
  loginByPhone: vi.fn(),
  loginByPin: vi.fn(),
  logout: vi.fn(),
  fetchStaffUsers: vi.fn(),
}));

vi.mock("./api/client", () => ({
  api: {
    get: authClient.get,
    post: authClient.post,
    patch: authClient.patch,
    delete: authClient.delete,
  },
  isAuthenticated: authClient.isAuthenticated,
  login: authClient.login,
  loginByPhone: authClient.loginByPhone,
  loginByPin: authClient.loginByPin,
  logout: authClient.logout,
  fetchStaffUsers: authClient.fetchStaffUsers,
  formatMoney: (value, currency = "UZS") => `${Number(value || 0)} ${currency}`,
  formatNumber: (value) => String(Number(value || 0)),
}));

vi.mock("./api/receipt", () => ({
  printKitchenReceipt: vi.fn(),
  printOrderReceipt: vi.fn(),
}));

const users = {
  owner: { id: "owner", role_slugs: ["owner"], email: "owner@marjon.test" },
  admin: { id: "admin", role_slugs: ["admin"], email: "admin@marjon.test" },
  manager: { id: "manager", role_slugs: ["manager"], email: "manager@marjon.test" },
  cashier: { id: "cashier", role_slugs: ["cashier"], email: "cashier@marjon.test" },
  waiter: { id: "waiter", role_slugs: ["waiter"], email: "waiter@marjon.test" },
  kitchen: { id: "kitchen", role_slugs: ["kitchen"], email: "kitchen@marjon.test" },
  unknown: { id: "unknown", role_slugs: ["auditor"], email: "unknown@marjon.test" },
  noRole: { id: "no-role", role_slugs: [], email: "norole@marjon.test" },
};

function emptyApiResponse(url) {
  if (url === "/analytics/dashboard") return {};
  return [];
}

function mockAuthenticatedUser(user) {
  localStorage.setItem("access_token", "test-token");
  authClient.isAuthenticated.mockReturnValue(true);
  authClient.get.mockImplementation((url) => {
    if (url === "/auth/me") return Promise.resolve({ data: user });
    return Promise.resolve({ data: emptyApiResponse(url) });
  });
}

function mockUnauthenticatedUser() {
  authClient.isAuthenticated.mockReturnValue(false);
  authClient.get.mockResolvedValue({ data: null });
}

function renderAt(pathname) {
  window.history.pushState({}, "", pathname);
  return render(<App />);
}

async function waitForPath(pathname) {
  await waitFor(() => expect(window.location.pathname).toBe(pathname));
}

async function expectAllowedRoute(pathname, user, selector = ".dashboard-shell") {
  mockAuthenticatedUser(user);

  renderAt(pathname);

  await waitForPath(pathname);
  if (selector) {
    await waitFor(() => expect(document.querySelector(selector)).toBeInTheDocument());
  }
}

async function expectRedirect(pathname, user, expectedPathname, forbiddenSelector = null) {
  mockAuthenticatedUser(user);

  renderAt(pathname);

  await waitForPath(expectedPathname);
  if (forbiddenSelector) {
    expect(document.querySelector(forbiddenSelector)).not.toBeInTheDocument();
  }
}

describe("role route guards", () => {
  beforeEach(() => {
    mockUnauthenticatedUser();
  });

  it("redirects an unauthenticated user from a protected route to login", async () => {
    renderAt("/finance/transactions");

    await waitForPath("/login");
  });

  it("allows owner to open an allowed route", async () => {
    mockAuthenticatedUser(users.owner);

    renderAt("/orders");

    await waitForPath("/orders");
    await waitFor(() => expect(document.querySelector(".dashboard-shell")).toBeInTheDocument());
  });

  it("allows admin to open an administrative route", async () => {
    mockAuthenticatedUser(users.admin);

    renderAt("/finance/transactions");

    await waitForPath("/finance/transactions");
    await waitFor(() => expect(document.querySelector(".finance-page")).toBeInTheDocument());
  });

  it("redirects cashier away from an administrative route opened directly", async () => {
    mockAuthenticatedUser(users.cashier);

    renderAt("/users");

    await waitForPath("/orders");
    expect(document.querySelector(".staff-page")).not.toBeInTheDocument();
  });

  it("redirects waiter away from a financial route", async () => {
    mockAuthenticatedUser(users.waiter);

    renderAt("/finance/transactions");

    await waitForPath("/waiter");
    expect(document.querySelector(".finance-page")).not.toBeInTheDocument();
  });

  it("redirects kitchen away from the owner dashboard section", async () => {
    mockAuthenticatedUser(users.kitchen);

    renderAt("/");

    await waitForPath("/kitchen");
    expect(document.querySelector(".owner-kpi-band")).not.toBeInTheDocument();
  });

  it("does not grant access to a user without a role", async () => {
    mockAuthenticatedUser(users.noRole);

    renderAt("/finance/transactions");

    await waitForPath("/login");
    expect(document.querySelector(".finance-page")).not.toBeInTheDocument();
  });

  it("redirects a forbidden user to the role home route", async () => {
    mockAuthenticatedUser(users.cashier);

    renderAt("/finance/transactions");

    await waitForPath("/orders");
  });

  it("does not redirect an allowed route", async () => {
    mockAuthenticatedUser(users.cashier);

    renderAt("/orders");

    await waitForPath("/orders");
    await waitFor(() => expect(document.querySelector(".dashboard-shell")).toBeInTheDocument());
  });

  it("does not show a protected page while auth is loading", async () => {
    localStorage.setItem("access_token", "test-token");
    authClient.isAuthenticated.mockReturnValue(true);

    let resolveProfile;
    authClient.get.mockImplementation((url) => {
      if (url === "/auth/me") {
        return new Promise((resolve) => {
          resolveProfile = resolve;
        });
      }
      return Promise.resolve({ data: emptyApiResponse(url) });
    });

    renderAt("/finance/transactions");

    expect(document.querySelector(".mj-loader-page")).toBeInTheDocument();
    expect(document.querySelector(".finance-page")).not.toBeInTheDocument();

    resolveProfile({ data: users.waiter });
    await waitForPath("/waiter");
  });

  it("does not create a redirect loop on a role home route", async () => {
    mockAuthenticatedUser(users.cashier);

    renderAt("/orders");

    await waitForPath("/orders");
    await waitFor(() => expect(window.location.pathname).toBe("/orders"));
  });

  it.each([
    ["owner", users.owner],
    ["cashier", users.cashier],
    ["waiter", users.waiter],
    ["kitchen", users.kitchen],
  ])("allows %s to open profile settings", async (_, user) => {
    await expectAllowedRoute("/settings/profile", user);
  });

  it("redirects an unknown role away from profile settings", async () => {
    await expectRedirect("/settings/profile", users.unknown, "/login", ".company-profile-page");
  });

  it.each([
    ["owner", users.owner],
    ["cashier", users.cashier],
    ["waiter", users.waiter],
    ["kitchen", users.kitchen],
  ])("allows %s to open support settings", async (_, user) => {
    await expectAllowedRoute("/settings/support", user);
  });

  it("redirects an unknown role away from support settings", async () => {
    await expectRedirect("/settings/support", users.unknown, "/login", ".empty-state");
  });

  it.each([
    ["owner", users.owner],
    ["admin", users.admin],
    ["manager", users.manager],
    ["cashier", users.cashier],
  ])("allows %s to open store", async (_, user) => {
    await expectAllowedRoute("/store", user);
  });

  it("redirects waiter away from store", async () => {
    await expectRedirect("/store", users.waiter, "/waiter", ".data-table");
  });

  it("redirects kitchen away from store", async () => {
    await expectRedirect("/store", users.kitchen, "/kitchen", ".data-table");
  });

  it.each([
    ["owner", users.owner],
    ["admin", users.admin],
    ["manager", users.manager],
  ])("allows %s to open reviews", async (_, user) => {
    await expectAllowedRoute("/reviews", user);
  });

  it("redirects cashier away from reviews", async () => {
    await expectRedirect("/reviews", users.cashier, "/orders", ".empty-state");
  });

  it("redirects waiter away from reviews", async () => {
    await expectRedirect("/reviews", users.waiter, "/waiter", ".empty-state");
  });

  it("redirects kitchen away from reviews", async () => {
    await expectRedirect("/reviews", users.kitchen, "/kitchen", ".empty-state");
  });

  it.each([
    ["owner", users.owner, "/"],
    ["superadmin", { is_superadmin: true, role_slugs: [] }, "/"],
    ["admin", users.admin, "/"],
    ["manager", users.manager, "/"],
    ["cashier", users.cashier, "/orders"],
    ["waiter", users.waiter, "/waiter"],
    ["kitchen", users.kitchen, "/kitchen"],
  ])("allows %s to open its role home without redirect loop", async (_, user, pathname) => {
    await expectAllowedRoute(pathname, user, null);
    await waitFor(() => expect(window.location.pathname).toBe(pathname));
  });

  it.each([
    ["admin", users.admin, "/finance/transactions"],
    ["manager", users.manager, "/finance/transactions"],
    ["admin", users.admin, "/reviews"],
    ["manager", users.manager, "/reviews"],
  ])("allows %s route access like manager for %s", async (_, user, pathname) => {
    await expectAllowedRoute(pathname, user);
  });
});
