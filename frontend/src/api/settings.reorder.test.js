import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 5C-6B: the reorder helper must hit PATCH /halls/reorder with the body
// passed through verbatim (no transformation, no per-hall calls) and reuse the
// shared axios client (JWT/refresh/error interceptors).
vi.mock("./client", () => ({
  api: { patch: vi.fn(() => Promise.resolve({ data: [] })) },
}));

import { api } from "./client";
import { settingsService } from "./settings";

describe("settingsService.reorderPlaces", () => {
  beforeEach(() => {
    api.patch.mockClear();
  });

  it("PATCHes /halls/reorder with the exact { branch_id, hall_ids } body", async () => {
    const payload = { branch_id: "b-main", hall_ids: ["a", "d", "b", "c"] };
    await settingsService.reorderPlaces(payload);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith("/halls/reorder", payload);
    // Body is passed through untouched — same reference, no reshaping.
    expect(api.patch.mock.calls[0][1]).toBe(payload);
  });

  it("forwards an axios config (e.g. abort signal) as the third argument", async () => {
    const payload = { branch_id: "b", hall_ids: ["x"] };
    const config = { signal: new AbortController().signal };
    await settingsService.reorderPlaces(payload, config);
    expect(api.patch).toHaveBeenCalledWith("/halls/reorder", payload, config);
  });

  it("issues exactly one request (never one PATCH per hall)", async () => {
    await settingsService.reorderPlaces({ branch_id: "b", hall_ids: ["1", "2", "3", "4"] });
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});
