/**
 * Семантическая нормализация CSS-значений.
 *
 * Нужна, чтобы не гоняться за фантомными расхождениями: `outline: 0` и
 * `outline: none`, `#ffffff` и `var(--neutral-0)` — это одно и то же.
 */
import fs from "node:fs";

/* ---- карта токенов из marjon-tokens.css ---- */
export function loadTokens(file = "src/styles/marjon-tokens.css") {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  const txt = fs.readFileSync(file, "utf8");
  for (const m of txt.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

const NAMED = {
  black: "rgb(0,0,0)", white: "rgb(255,255,255)", red: "rgb(255,0,0)",
  transparent: "rgba(0,0,0,0)", currentcolor: "currentcolor",
};

function hexToRgb(h) {
  h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) {
    return `rgb(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)})`;
  }
  if (h.length === 8) {
    const a = parseInt(h.slice(6, 8), 16) / 255;
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${round(a)})`;
  }
  return "#" + h;
}

const round = (n) => String(Math.round(n * 1000) / 1000);

/** Развернуть var(--x) и var(--x, fallback) по карте токенов. */
function expandVars(v, tokens, depth = 0) {
  if (depth > 12 || !v.includes("var(")) return v;
  let out = "";
  let i = 0;
  while (i < v.length) {
    const at = v.indexOf("var(", i);
    if (at === -1) { out += v.slice(i); break; }
    out += v.slice(i, at);
    // найти парную скобку
    let d = 1, j = at + 4;
    while (j < v.length && d > 0) {
      if (v[j] === "(") d++;
      else if (v[j] === ")") d--;
      j++;
    }
    const inner = v.slice(at + 4, j - 1);
    // разделить имя и fallback по первой запятой верхнего уровня
    let dd = 0, ci = -1;
    for (let k = 0; k < inner.length; k++) {
      if (inner[k] === "(") dd++;
      else if (inner[k] === ")") dd--;
      else if (inner[k] === "," && dd === 0) { ci = k; break; }
    }
    const name = (ci === -1 ? inner : inner.slice(0, ci)).trim();
    const fb = ci === -1 ? "" : inner.slice(ci + 1).trim();
    const resolved = tokens.get(name);
    out += resolved !== undefined ? expandVars(resolved, tokens, depth + 1)
         : fb ? expandVars(fb, tokens, depth + 1)
         : `var(${name})`;
    i = j;
  }
  return out;
}

/** Свойства, где 0 и none эквивалентны. */
const ZERO_IS_NONE = new Set(["outline", "border", "border-top", "border-right",
  "border-bottom", "border-left", "box-shadow", "text-shadow", "background-image"]);

export function normalize(prop, value, tokens) {
  if (value == null) return null;
  let v = String(value).trim().toLowerCase();

  v = expandVars(v, tokens);

  // цвета
  v = v.replace(/#[0-9a-f]{3,8}\b/g, (m) => hexToRgb(m));
  v = v.replace(/\b(black|white|red|transparent)\b/g, (m) => NAMED[m] || m);
  // rgb/rgba: убрать пробелы, привести rgba с a=1 к rgb
  v = v.replace(/rgba?\(([^()]*)\)/g, (m, inner) => {
    const parts = inner.split(/[,\s/]+/).filter(Boolean).map((x) => x.trim());
    if (parts.length < 3) return m;
    const [r, g, b] = parts;
    let a = parts[3];
    if (a === undefined || a === "1" || a === "1.0" || a === "100%") return `rgb(${r},${g},${b})`;
    if (a.endsWith("%")) a = round(parseFloat(a) / 100);
    else a = round(parseFloat(a));
    return `rgba(${r},${g},${b},${a})`;
  });

  // числа: .5 -> 0.5, 0px -> 0, убрать хвостовые нули
  v = v.replace(/(^|[\s,(])\.(\d)/g, "$10.$2");
  v = v.replace(/\b0(px|rem|em|%|vh|vw|pt)\b/g, "0");
  // хвостовые нули в дробях: 0.50 -> 0.5, 1.0 -> 1
  v = v.replace(/(\d)\.(\d*?)0+(?!\d)/g, (m, a, b) => (b ? `${a}.${b}` : a));
  v = v.replace(/(\d)\.(?!\d)/g, "$1");

  // пробелы
  v = v.replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();

  if (ZERO_IS_NONE.has(prop) && (v === "0" || v === "none")) return "none";
  if (v === "0 0" || v === "0 0 0" || v === "0 0 0 0") v = "0";

  return v;
}
