import { afterEach, describe, expect, it, vi } from "vitest";

describe("api client", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("uses VITE_API_URL as the axios base URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.marjon.test/api/v1");

    const { API_BASE_URL, api } = await import("./client");

    expect(API_BASE_URL).toBe("https://api.marjon.test/api/v1");
    expect(api.defaults.baseURL).toBe("https://api.marjon.test/api/v1");
  });
});
