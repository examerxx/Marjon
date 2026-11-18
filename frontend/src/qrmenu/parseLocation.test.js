import { describe, expect, it } from "vitest";
import { parseLocation } from "./QrMenuApp";
import { buildQrLinks } from "../pages/settings/profile/QrMenuSection";

describe("адреса QR-меню", () => {
  it("разбирает полные и короткие адреса", () => {
    expect(parseLocation("/m/sardor")).toEqual({ slug: "sardor", token: "", short: "" });
    expect(parseLocation("/m/sardor/abc")).toEqual({ slug: "sardor", token: "abc", short: "" });
    expect(parseLocation("/M/SARDOR")).toEqual({ slug: "SARDOR", token: "", short: "" });
    expect(parseLocation("/T/K7Q2M9X")).toEqual({ slug: "", token: "", short: "K7Q2M9X" });
    expect(parseLocation("/t/k7q2m9x")).toEqual({ slug: "", token: "", short: "K7Q2M9X" });
    expect(parseLocation("/")).toEqual({ slug: "", token: "", short: "" });
  });

  it("в QR — короткий адрес заглавными, человеку — строчными; без кода — старая ссылка", () => {
    const links = buildQrLinks({
      slug: "sardor",
      tables: [
        { table_id: "1", number: 1, hall: "Зал", branch: null, token: "tok1", short_code: "K7Q2M9X" },
        { table_id: "2", number: 2, hall: "Зал", branch: null, token: "tok2" },
      ],
    }, "https://admin.marjon.tech");
    expect(links[0]).toMatchObject({ url: "https://admin.marjon.tech/m/sardor", qr: "HTTPS://ADMIN.MARJON.TECH/M/SARDOR" });
    expect(links[1]).toMatchObject({ url: "https://admin.marjon.tech/t/k7q2m9x", qr: "HTTPS://ADMIN.MARJON.TECH/T/K7Q2M9X" });
    expect(links[2]).toMatchObject({ url: "https://admin.marjon.tech/m/sardor/tok2", qr: "https://admin.marjon.tech/m/sardor/tok2" });
  });
});
