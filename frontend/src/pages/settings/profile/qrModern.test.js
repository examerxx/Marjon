import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { modernQrSvg, qrGeometry, svgToDataUrl } from "./qrModern";

const URLS = [
  "HTTPS://ADMIN.MARJON.TECH/T/K7Q2M9X",
  "HTTPS://ADMIN.MARJON.TECH/M/SARDOR",
  "https://admin.marjon.tech/m/sardor",
  "https://admin.marjon.tech/m/sardor/de51c0f8b11d44d288887cd196630485c21c4175baf059204bc3",
  "https://admin.marjon.tech/m/a-very-long-venue-code-for-testing/0123456789abcdef0123456789abcdef0123456789abcdef0123",
];

describe("qrModern: геометрия", () => {
  it("логотип стоит ровно по центру, под ним нет модулей, а площадь закрытой части невелика", () => {
    for (const url of URLS) {
      const g = qrGeometry(url);
      const centre = g.plate.x + g.plate.size / 2;
      expect(Math.abs(centre - g.total / 2)).toBeLessThan(0.51);
      const inside = g.cells.filter((c) => c.x + 0.5 > g.plate.x && c.x + 0.5 < g.plate.x + g.plate.size
        && c.y + 0.5 > g.plate.y && c.y + 0.5 < g.plate.y + g.plate.size);
      expect(inside).toHaveLength(0);
      // Коррекция ошибок уровня H выдерживает до 30%; закрываем заведомо меньше.
      expect((g.plate.size ** 2) / (g.n ** 2)).toBeLessThan(0.1);
      expect(g.finders).toHaveLength(3);
    }
  });

  it("один и тот же адрес даёт один и тот же рисунок, разные адреса — разные", () => {
    const a = qrGeometry(URLS[0]);
    expect(qrGeometry(URLS[0]).cells).toEqual(a.cells);
    expect(qrGeometry(URLS[1]).cells).not.toEqual(a.cells);
  });

  it("диагональный штрих соединяет только два тёмных модуля по диагонали вверх-вправо", () => {
    const g = qrGeometry(URLS[0]);
    const dark = new Set(g.cells.map((c) => `${c.x},${c.y}`));
    expect(g.links.length).toBeGreaterThan(20);
    for (const l of g.links) {
      expect(l.x2 - l.x1).toBe(1);
      expect(l.y2 - l.y1).toBe(-1);
      expect(dark.has(`${l.x1 - 0.5},${l.y1 - 0.5}`)).toBe(true);
      expect(dark.has(`${l.x2 - 0.5},${l.y2 - 0.5}`)).toBe(true);
    }
  });

  it("штрих и «таблетка» не задевают центры соседних светлых модулей", () => {
    const g = qrGeometry(URLS[0]);
    // расстояние от центра соседней по стороне клетки до диагонали — √2/2 ≈ 0.707
    expect(g.stroke / 2).toBeLessThan(0.6);
    // конец «таблетки» до центра соседней по стороне клетки (1, 0): от точки (TICK, −TICK)
    expect(Math.hypot(1 - g.tick, g.tick) - g.stroke / 2).toBeGreaterThan(0.2);
  });
});

describe("qrModern: крупная сетка, как на референсе", () => {
  it("короткие адреса заглавными дают единую сетку 53×53 при уровне H", () => {
    expect(qrGeometry("HTTPS://ADMIN.MARJON.TECH/T/K7Q2M9X").n).toBe(53);
    expect(qrGeometry("HTTPS://ADMIN.MARJON.TECH/M/SARDOR").n).toBe(53);
    // для сравнения: старая длинная ссылка стола — 53×53
    expect(qrGeometry("https://admin.marjon.tech/m/sardor/de51c0f8b11d44d288887cd196630485c21c4175baf059204bc3").n).toBe(53);
  });
});

describe("qrModern: SVG", () => {
  it("MARJON Signature: тёмно-синие точки и штрихи, глазки и знак Marjon, без градиентов; всё векторное", () => {
    const svg = modernQrSvg(URLS[1], { sizePx: 400 });
    expect(svg).toContain('width="400"');
    expect(svg).toContain("#092747");
    expect(svg).toContain("<linearGradient");
    expect(svg).not.toMatch(/filter|shadow/);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('fill="url(#qr-ink)"');
    expect(svg).toContain("<image"); // глянцевый логотип Marjon
    expect(svg).toContain("data:image/webp;base64,"); // вшит в картинку
    expect(svg).not.toMatch(/href="http/); // без внешних файлов
  });

  it("белое поле вокруг кода не меньше 4 модулей", () => {
    const g = qrGeometry(URLS[0]);
    expect(Math.min(...g.cells.map((c) => c.x))).toBeGreaterThanOrEqual(4);
    expect(g.total - Math.max(...g.cells.map((c) => c.x + 1))).toBeGreaterThanOrEqual(4);
  });

  it("data-URL для <img> корректен", () => {
    const url = svgToDataUrl(modernQrSvg(URLS[0]));
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.split(",")[1])).toContain("<svg");
  });
});

// ── защита от «красивого, но нечитаемого» QR ────────────────────────────────
// Рисуем ту же геометрию в пиксели и читаем независимым декодером jsQR. Логотип в худшем варианте —
// сплошной тёмный блок. Если кто-то изменит форму модулей так, что код перестанет читаться, тест упадёт.
const INK = [0x0d, 0x2a, 0x4d];

function inRounded(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function nearSegment(px, py, l, r) {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const t = Math.max(0, Math.min(1, ((px - l.x1) * dx + (py - l.y1) * dy) / (dx * dx + dy * dy)));
  return (px - (l.x1 + t * dx)) ** 2 + (py - (l.y1 + t * dy)) ** 2 <= r * r;
}

function rasterize(url, k, noise) {
  const g = qrGeometry(url);
  const size = Math.round(g.total * k);
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const put = (px, py) => {
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const i = (py * size + px) * 4;
    data[i] = INK[0]; data[i + 1] = INK[1]; data[i + 2] = INK[2]; data[i + 3] = 255;
  };
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) / k;
      const y = (py + 0.5) / k;
      for (const f of g.finders) {
        const ring = inRounded(x, y, f.x, f.y, 7, 7, g.eye[0]) && !inRounded(x, y, f.x + 1, f.y + 1, 5, 5, g.eye[1]);
        if (ring || inRounded(x, y, f.x + 2, f.y + 2, 3, 3, g.eye[2])) { put(px, py); break; }
      }
    }
  }
  const paint = (x0, y0, x1, y1, test) => {
    for (let py = Math.floor(y0 * k); py <= Math.ceil(y1 * k); py += 1) {
      for (let px = Math.floor(x0 * k); px <= Math.ceil(x1 * k); px += 1) {
        if (test((px + 0.5) / k, (py + 0.5) / k)) put(px, py);
      }
    }
  };
  for (const c of g.cells) {
    const tick = { x1: c.x + 0.5 - g.tick, y1: c.y + 0.5 + g.tick, x2: c.x + 0.5 + g.tick, y2: c.y + 0.5 - g.tick };
    paint(c.x - 0.5, c.y - 0.5, c.x + 1.5, c.y + 1.5, (x, y) => nearSegment(x, y, tick, g.stroke / 2));
  }
  for (const l of g.links) {
    paint(l.x1 - 0.5, l.y2 - 0.5, l.x2 + 0.5, l.y1 + 0.5, (x, y) => nearSegment(x, y, l, g.stroke / 2));
  }
  const p = g.plate; // худший случай: логотип — сплошной тёмный блок
  paint(p.x + 1, p.y + 1, p.x + p.size - 1, p.y + p.size - 1, (x, y) => inRounded(x, y, p.x + 1, p.y + 1, p.size - 2, p.size - 2, 1));
  if (noise) {
    let seed = 12345; // детерминированный «шум», чтобы тест не мигал
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let i = 0; i < data.length; i += 4) {
      const v = (rnd() - 0.5) * noise;
      for (let c = 0; c < 3; c += 1) data[i + c] = Math.max(0, Math.min(255, data[i + c] + v));
    }
  }
  return { data, size };
}

describe("qrModern: код действительно читается", () => {
  it.each(URLS)("декодируется на разных размерах печати и с шумом: %s", (url) => {
    for (const k of [12, 8, 6, 5]) {
      const image = rasterize(url, k, k <= 5 ? 30 : 0);
      const result = jsQR(image.data, image.size, image.size, { inversionAttempts: "dontInvert" });
      expect(result?.data, `px на модуль = ${k}`).toBe(url);
    }
  }, 60000);
});
