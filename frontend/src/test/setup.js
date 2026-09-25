import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import "../i18n/index.js";
import { __resetReportCache } from "../pages/reports/reportResultCache";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  // The Reports session cache is a module-level singleton; clear it between
  // tests so a cached result from one case never leaks into the next.
  __resetReportCache();
});
