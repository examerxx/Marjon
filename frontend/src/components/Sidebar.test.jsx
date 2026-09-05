import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { updateStoredProfile } from "../utils/profileCache";
import Sidebar from "./Sidebar";

const appUser = (role, id = role) => ({
  id,
  role_slugs: [role],
  email: `${id}@marjon.test`,
  auth_scope: "app",
  company_id: "company-1",
  is_superadmin: false,
});

const users = {
  owner: appUser("owner"),
  manager: appUser("manager"),
  cashier: appUser("cashier"),
  waiter: appUser("waiter"),
  kitchen: appUser("kitchen"),
  admin: appUser("admin"),
  superadmin: {
    id: "superadmin",
    is_superadmin: true,
    auth_scope: "hq_admin",
    company_id: null,
    role_slugs: [],
    email: "superadmin@marjon.test",
  },
};

function renderSidebar(user, initialPath = "/", collapsed = false) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar user={user} collapsed={collapsed} onToggle={vi.fn()} />
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

describe("OWNER Sidebar", () => {
  it("does not crash when user data is missing and exposes no protected navigation", () => {
    renderSidebar(null);

    expect(screen.getByAltText("Owner")).toBeInTheDocument();
    expect(getLinkByHref("/finance")).not.toBeInTheDocument();
  });

  it("uses server identity instead of a cached display name", () => {
    updateStoredProfile("owner", { name: "Stale cached name", photo: "data:image/png;base64,owner" });
    renderSidebar({ ...users.owner, full_name: "Server Owner" });

    expect(screen.getAllByText("Server Owner").length).toBeGreaterThan(0);
    expect(screen.queryByText("Stale cached name")).not.toBeInTheDocument();
  });

  it("preserves the server OWNER role", () => {
    renderSidebar(users.owner);

    expect(screen.getAllByText("owner").length).toBeGreaterThan(0);
    expect(getLinkByHref("/finance/transactions")).toBeInTheDocument();
  });

  it("keeps every visible top-level navigation icon in the collapsed rail", () => {
    const { unmount } = renderSidebar(users.owner);
    const expectedTopLevelCount = document.querySelectorAll(".sidebar-nav > .sidebar-nav-item").length;
    unmount();

    renderSidebar(users.owner, "/", true);
    expect(document.querySelector(".sidebar-nav")?.parentElement).toHaveClass("sidebar-nav-scroll");
    const collapsedItems = [...document.querySelectorAll(".sidebar-nav > .sidebar-nav-item")];
    const collapsedIcons = collapsedItems.filter((item) => (
      item.querySelector(":scope > .sidebar-link > .sidebar-icon")
    ));
    const collapsedInlineSubmenus = document.querySelectorAll(
      ".sidebar-nav > .sidebar-nav-item.has-submenu > .sidebar-submenu",
    );

    expect(expectedTopLevelCount).toBeGreaterThan(1);
    expect(collapsedItems).toHaveLength(expectedTopLevelCount);
    expect(collapsedIcons).toHaveLength(expectedTopLevelCount);
    collapsedItems.forEach((item) => {
      const control = item.querySelector(":scope > .sidebar-link");
      expect(control).toHaveAccessibleName();
      expect(control).toHaveAttribute("title");
    });
    expect(collapsedInlineSubmenus).toHaveLength(0);
  });

  it("keeps operational role links under OWNER staff management", () => {
    renderSidebar(users.owner);

    [
      "/users/cashier",
      "/users/waiter",
      "/users/courier",
      "/users/monoblock",
      "/users/kitchen",
      "/users/manager",
      "/users/warehouse",
    ].forEach((href) => expect(getLinkByHref(href)).toBeInTheDocument());
  });

  it("shows OWNER account links", async () => {
    renderSidebar(users.owner);
    await openAccountMenu();

    expect(getLinkByHref("/settings/profile")).toBeInTheDocument();
    expect(getLinkByHref("/settings/support")).toBeInTheDocument();
    expect(getLinkByHref("/store")).toBeInTheDocument();
    expect(getLinkByHref("/reviews")).toBeInTheDocument();
  });

  it("keeps profile and language panels mounted until their exit animations finish", async () => {
    const user = userEvent.setup();
    const finishAnimation = (element, animationName) => {
      for (const eventName of ["animationend", "webkitAnimationEnd"]) {
        const event = new Event(eventName, { bubbles: true });
        Object.defineProperty(event, "animationName", { value: animationName });
        fireEvent(element, event);
      }
    };
    renderSidebar(users.owner);
    await user.click(document.querySelector(".sidebar-user--button"));
    await user.click(document.querySelector(".sidebar-account__lang-trigger"));

    const languagePanel = document.querySelector(".sidebar-account__lang-panel");
    expect(languagePanel).toBeInTheDocument();
    await user.click(document.querySelector(".sidebar-account__lang-trigger"));
    expect(languagePanel).toHaveClass("is-closing");
    finishAnimation(languagePanel, "owner-lang-panel-out");
    await waitFor(() => expect(document.querySelector(".sidebar-account__lang-panel")).not.toBeInTheDocument());

    const profilePanel = document.querySelector(".sidebar-account__menu");
    await user.click(document.querySelector(".sidebar-user--button"));
    expect(profilePanel).toHaveClass("is-closing");
    finishAnimation(profilePanel, "owner-account-menu-out");
    await waitFor(() => expect(document.querySelector(".sidebar-account__menu")).not.toBeInTheDocument());
  });

  it.each([
    ["manager", users.manager],
    ["cashier", users.cashier],
    ["waiter", users.waiter],
    ["kitchen", users.kitchen],
    ["legacy admin", users.admin],
    ["SUPER_ADMIN", users.superadmin],
  ])("does not build a Web client menu for %s", async (_, actor) => {
    renderSidebar(actor);
    await openAccountMenu();

    expect(getLinkByHref("/")).not.toBeInTheDocument();
    expect(getLinkByHref("/settings/profile")).not.toBeInTheDocument();
    expect(getLinkByHref("/settings/support")).not.toBeInTheDocument();
    expect(getLinkByHref("/store")).not.toBeInTheDocument();
    expect(getLinkByHref("/reviews")).not.toBeInTheDocument();
  });
});
