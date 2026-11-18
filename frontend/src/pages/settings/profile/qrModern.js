// Фирменный стиль QR «MARJON Signature»: тёмно-синие модули — короткие косые «таблетки», соседние по диагонали
// сливаются в наклонные штрихи (как на референсе), три крупных угловых маркера — закруглённые
// квадраты, белый фон и оригинальный логотип Marjon по центру. Всё рисуется векторной SVG-разметкой
// без внешних файлов, поэтому одинаково чётко выглядит на экране, в SVG/PNG и на бумаге.
//
// QR строится с максимальной коррекцией ошибок (уровень H, до 30% повреждений); под логотипом модули
// не рисуются. Штрих идёт строго через общий угол двух диагональных модулей и уже клетки, поэтому
// центры соседних светлых модулей остаются белыми — сканер читает код как обычный.
import QRCode from "qrcode";
import { MARJON_LOGO } from "./qrLogo";

export const QR_STYLE_NAME = "MARJON Signature";
const INK = "#092747";
const QUIET = 5; // оставляем четыре белых модуля и запас для увеличенных углов
const LOGO_SHARE = 0.16; // сторона свободной зоны под логотип относительно стороны QR
const EYE = [2.3, 1.6, 1.15];
const TICK = 0.27;
const STROKE = 0.76;
const MAX_RUN = 3;

const rounded = (x, y, w, h, r) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

// Геометрия QR в модулях: из неё строится и картинка, и проверка «читается ли код».
// cells — тёмные модули (вне маркеров и логотипа), links — диагональные штрихи «снизу-слева
// вверх-вправо» между модулями (r, c) и (r − 1, c + 1), координаты — центры модулей.
export function qrGeometry(url) {
  const options = { errorCorrectionLevel: "H" };
  const value = String(url);
  const qr = QRCode.create(value, options);
  const { modules } = qr.version < 9 ? QRCode.create(value, { ...options, version: 9 }) : qr;
  const n = modules.size;
  const total = n + QUIET * 2;
  let clear = Math.ceil(n * LOGO_SHARE);
  if (clear % 2 === 0) clear += 1; // нечётная сторона — логотип ровно по центру
  const start = Math.floor((n - clear) / 2);
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const inLogo = (r, c) => r >= start && r < start + clear && c >= start && c < start + clear;
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && modules.get(r, c) && !inFinder(r, c) && !inLogo(r, c);
  const cells = [];
  const links = [];
  const runs = new Map();
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!dark(r, c)) continue;
      cells.push({ x: c + QUIET, y: r + QUIET });
      const length = runs.get(r * n + c) ?? 1;
      if (length < MAX_RUN && dark(r + 1, c - 1)) {
        runs.set((r + 1) * n + c - 1, length + 1);
        links.push({ x1: c + QUIET - 0.5, y1: r + QUIET + 1.5, x2: c + QUIET + 0.5, y2: r + QUIET + 0.5 });
      }
    }
  }
  const finders = [[0, 0], [0, n - 7], [n - 7, 0]].map(([r, c]) => ({ x: c + QUIET, y: r + QUIET }));
  const plate = { x: start + QUIET, y: start + QUIET, size: clear };
  return { n, total, cells, links, finders, plate, eye: EYE, tick: TICK, stroke: STROKE };
}

export function modernQrSvg(url, { sizePx = 320 } = {}) {
  const { n, total, cells, finders, plate } = qrGeometry(url);
  const leaf = (x, y, size, wide, narrow) =>
    `M${x + wide} ${y}H${x + size - narrow}Q${x + size} ${y} ${x + size} ${y + narrow}V${y + size - wide}Q${x + size} ${y + size} ${x + size - wide} ${y + size}H${x + narrow}Q${x} ${y + size} ${x} ${y + size - narrow}V${y + wide}Q${x} ${y} ${x + wide} ${y}Z`;
  const eyes = finders
    .map(({ x, y }) => leaf(x, y, 7, 3.4, 1.45) + leaf(x + 1, y + 1, 5, 2.45, .8) + leaf(x + 2, y + 2, 3, 1.55, .55))
    .join("");
  const modules = cells.map(({ x, y }) => `M${x} ${y}h1v1h-1z`).join("");
  const margin = n * (QUIET / 53);
  const viewStart = QUIET - margin;
  const viewSize = n + 2 * margin;
  const w = Math.min(plate.size - .5, n * (8.3 / 53));
  const inset = (plate.size - w) / 2;
  const h = (w * MARJON_LOGO.height) / MARJON_LOGO.width;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewStart} ${viewStart} ${viewSize} ${viewSize}" width="${sizePx}" height="${sizePx}" role="img" aria-label="QR-код" style="display:block">` +
    `<rect x="${viewStart}" y="${viewStart}" width="${viewSize}" height="${viewSize}" fill="#ffffff"/>` +
    `<defs><linearGradient id="qr-ink" gradientUnits="userSpaceOnUse" x2="${total}" y2="${total}"><stop stop-color="#006c66"/><stop offset="48%" stop-color="#007891"/><stop offset="100%" stop-color="${INK}"/></linearGradient></defs>` +
    `<path fill="url(#qr-ink)" fill-rule="evenodd" d="${eyes}"/>` +
    `<path fill="url(#qr-ink)" d="${modules}"/>` +
    `<image x="${plate.x + inset}" y="${plate.y + inset + (w - h) / 2}" width="${w}" height="${h}" href="${MARJON_LOGO.src}" preserveAspectRatio="xMidYMid meet"/>` +
    `</svg>`
  );
}

export const svgToDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// Файл SVG для скачивания: чистый вектор, масштабируется без потерь (для типографии).
export const qrSvgFileUrl = (url) => svgToDataUrl(`<?xml version="1.0" encoding="UTF-8"?>${modernQrSvg(url, { sizePx: 1024 })}`);

// PNG высокого разрешения для скачивания.
export function qrPngDataUrl(url, px = 2048) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, px, px);
      context.drawImage(image, 0, 0, px, px);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Не удалось подготовить PNG"));
    image.src = svgToDataUrl(modernQrSvg(url, { sizePx: px }));
  });
}
