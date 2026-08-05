import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

const users = {
  owner: { id: "owner", role_slugs: ["owner"], email: "owner@marjon.test" },
  superadmin: { id: "superadmin", is_superadmin: true, role_slugs: [], email: "superadmin@marjon.test" },
  admin: { id: "admin", role_slugs: ["admin"], email: "admin@marjon.test" },
  manager: { id: "manager", role_slugs: ["manager"], email: "manager@marjon.test" },
  cashier: { id: "cashier", role_slugs: ["cashier"], email: "cashier@marjon.test" },
  waiter: { id: "waiter", role_slugs: ["waiter"], email: "waiter@marjon.test" },
  kitchen: { id: "kitchen", role_slugs: ["kitchen"], email: "kitchen@marjon.test" },
  unknown: { id: "unknown", role_slugs: ["auditor"], email: "unknown@marjon.test" },
};

function renderSidebar(user, initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar user={user} collapsed={false} onToggle={vi.fn()} />
    </MemoryRouter>,
  );
}

function getLinkByHref(href) {
  return document.querySelector(`a[href="${href}"]`);
}

async function openAccountMenu() {
  const user = userEvent.setup();
  await user.click(document.querySelector(".sidebar-user--button"));
}

describe("Sidebar", () => {
  it("does not crash when user data is missing", () => {
    renderSidebar(null);

    expect(screen.getByAltText("Owner")).toBeInTheDocument();
  });

  it("shows an allowed navigation link and hides a forbidden one", () => {
    renderSidebar(users.cashier);

    expect(getLinkByHref("/")).toBeInTheDocument();
    expect(getLinkByHref("/finance")).not.toBeInTheDocument();
  });

  it.each([
    ["owner", users.owner],
    ["cashier", users.cashier],
    ["waiter", users.waiter],
    ["kitchen", users.kitchen],
  ])("shows profile in the account menu for %s", async (_, user) => {
    renderSidebar(user);
    await openAccountMenu();

    expect(getLinkByHref("/settings/profile")).toBeInTheDocument();
  });

  it.each([
    ["owner", users.owner],
    ["superadmin", users.superadmin],
    ["admin", users.admin],
    ["manager", users.manager],
    ["cashier", users.cashier],
    ["waiter", users.waiter],
    ["kitchen", users.kitchen],
  ])("shows support in the account menu for %s", async (_, user) => {
    renderSidebar(user);
    await openAccountMenu();

    expect(getLinkByHref("/settings/support")).toBeInTheDocument();
  });

  it("shows store and hides reviews for cashier", async () => {
    renderSidebar(users.cashier);
    await openAccountMenu();

    expect(getLinkByHref("/store")).toBeInTheDocument();
    expect(getLinkByHref("/reviews")).not.toBeInTheDocument();
  });

  it.each([
    ["waiter", users.waiter],
    ["kitchen", users.kitchen],
  ])("hides store and reviews for %s", async (_, user) => {
    renderSidebar(user);
    await openAccountMenu();

    expect(getLinkByHref("/store")).not.toBeInTheDocument();
    expect(getLinkByHref("/reviews")).not.toBeInTheDocument();
  });

  it.each([
    ["owner", users.owner],
    ["admin", users.admin],
    ["manager", users.manager],
  ])("shows reviews for %s", async (_, user) => {
    renderSidebar(user);
    await openAccountMenu();

    expect(getLinkByHref("/reviews")).toBeInTheDocument();
  });

  it("hides protected account links for an unknown role", async () => {
    renderSidebar(users.unknown);
    await openAccountMenu();

    expect(getLinkByHref("/settings/profile")).not.toBeInTheDocument();
    expect(getLinkByHref("/settings/support")).not.toBeInTheDocument();
    expect(getLinkByHref("/store")).not.toBeInTheDocument();
    expect(getLinkByHref("/reviews")).not.toBeInTheDocument();
  });
});
