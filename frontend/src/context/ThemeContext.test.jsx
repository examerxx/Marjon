import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";
import TopbarThemeToggle from "../components/topbar/TopbarThemeToggle";

function Probe() {
  const { theme, toggle, setTheme } = useTheme();
  return <>
    <output>{theme}</output>
    <TopbarThemeToggle />
    <button onClick={() => { toggle(); toggle(); }}>Double toggle</button>
    <button onClick={() => setTheme("invalid")}>Invalid</button>
  </>;
}

function mount() {
  return render(<ThemeProvider><Probe /></ThemeProvider>);
}

describe("Owner theme preference", () => {
  it("starts light and ignores the operating system preference", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    try {
      mount();
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(screen.getByRole("button", { name: "Тёмная тема" })).toHaveAttribute("aria-pressed", "false");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("switches both ways and restores a saved preference after remount", () => {
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Тёмная тема" }));
    expect(localStorage.getItem("marjon_theme")).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "Тёмная тема" })).toHaveAttribute("aria-pressed", "true");
    view.unmount();
    mount();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    fireEvent.click(screen.getByRole("button", { name: "Тёмная тема" }));
    expect(localStorage.getItem("marjon_theme")).toBe("light");
  });

  it("keeps rapid batched toggles consistent and rejects invalid values", () => {
    mount();
    fireEvent.click(screen.getByText("Double toggle"));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    fireEvent.click(screen.getByText("Invalid"));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("falls back to light for an invalid saved value", () => {
    localStorage.setItem("marjon_theme", "invalid");
    mount();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("works even if browser storage rejects reads and writes", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Тёмная тема" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("synchronizes other tabs, ignores unrelated storage, and removes its listener", () => {
    const view = mount();
    const change = (key, newValue, storageArea = localStorage) => act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea }));
    });
    change("marjon_theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    change("marjon_theme", "light", sessionStorage);
    change("unrelated", "light");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    change(null, null);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    view.unmount();
    change("marjon_theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
