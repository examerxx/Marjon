import { describe, expect, it, vi } from "vitest";
import { settingsService } from "./settings";

const apiTransportPost = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: {} })));
const apiTransportDelete = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: {} })));

vi.mock("./client", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: apiTransportPost,
    patch: vi.fn(() => Promise.resolve({ data: {} })),
    delete: apiTransportDelete,
  },
}));

describe("settingsService company logo contract (multipart, no base64)", () => {
  it("posts the file as FormData to the canonical logo endpoint", async () => {
    const file = new File(["fake-bytes"], "logo.png", { type: "image/png" });
    await settingsService.uploadCompanyLogo(file);
    expect(apiTransportPost).toHaveBeenCalledTimes(1);
    const [url, body] = apiTransportPost.mock.calls[0];
    expect(url).toBe("/companies/me/logo");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBe(file);
  });

  it("deletes through the canonical logo endpoint", async () => {
    await settingsService.deleteCompanyLogo();
    expect(apiTransportDelete).toHaveBeenCalledWith("/companies/me/logo");
  });
});
