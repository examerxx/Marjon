#!/usr/bin/env node
// Публикация сборки десктопа в Marjon store.
//
// Берёт артефакты electron-builder из desktop/dist, приводит имена к принятому
// в магазине виду (Marjon-Setup-<версия>.exe / Marjon-Portable-<версия>.exe),
// кладёт их в store-files/ и дописывает релиз в store-files/manifest.json.
//
// Страница /store читает именно этот манифест: таблица и ссылки на скачивание
// строятся из него, поэтому манифест обязан совпадать с файлами на диске.
// Размер и SHA-256 считаются здесь же — руками их не заполняем, иначе цифры
// расходятся с реальным файлом и пользователь видит битую контрольную сумму.
//
// Запуск: node desktop/scripts/publish-store.mjs [--notes "текст"] [--dry-run]

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const desktopDir = resolve(here, "..");
const distDir = join(desktopDir, "dist");
const storeDir = join(repoRoot, "store-files");
const manifestPath = join(storeDir, "manifest.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const notesIndex = args.indexOf("--notes");
const notes = notesIndex >= 0 ? args[notesIndex + 1] : "";

const pkg = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
const version = pkg.version;

if (!existsSync(distDir)) {
  console.error(`Нет папки сборки: ${distDir}\nСначала: cd desktop && npm run package`);
  process.exit(1);
}

// В dist копятся сборки прошлых версий: electron-builder их не удаляет.
// Берём только .exe текущей версии, иначе в магазин уедет старый бинарник.
const allArtifacts = readdirSync(distDir).filter((name) => name.toLowerCase().endsWith(".exe"));
const artifacts = allArtifacts.filter((name) => name.includes(version));
const skipped = allArtifacts.filter((name) => !name.includes(version));
if (skipped.length) {
  console.log(`Пропущены чужие версии: ${skipped.join(", ")}`);
}
if (!artifacts.length) {
  console.error(`В ${distDir} нет .exe версии ${version} — соберите «npm run package».`);
  process.exit(1);
}

// electron-builder называет файлы «Marjon Setup 1.0.1.exe» и «Marjon 1.0.1.exe».
// Различаем по слову Setup; всё остальное считаем portable-сборкой.
function classify(name) {
  return /setup/i.test(name) ? "installer" : "portable";
}

const wanted = { installer: null, portable: null };
for (const name of artifacts) {
  const kind = classify(name);
  if (!wanted[kind]) wanted[kind] = name;
}

const files = [];
for (const [kind, sourceName] of Object.entries(wanted)) {
  if (!sourceName) continue;
  const targetName = kind === "installer" ? `Marjon-Setup-${version}.exe` : `Marjon-Portable-${version}.exe`;
  const sourcePath = join(distDir, sourceName);
  const targetPath = join(storeDir, targetName);
  const bytes = statSync(sourcePath).size;
  const sha256 = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");

  if (!dryRun) {
    mkdirSync(storeDir, { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
  files.push({
    kind,
    label: kind === "installer" ? "Установщик" : "Portable",
    file: targetName,
    size: bytes,
    sha256,
  });
  console.log(`${dryRun ? "[dry] " : ""}${sourceName} -> store-files/${targetName} (${(bytes / 1048576).toFixed(2)} МБ)`);
}

if (!files.length) {
  console.error("Нечего публиковать.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const releases = Array.isArray(manifest.releases) ? manifest.releases : [];

// Одна версия — одна запись. Повторный запуск обновляет её, а не плодит дубли.
const existingIndex = releases.findIndex((release) => release.version === version);
const entry = {
  version,
  platform: "windows",
  channel: "stable",
  date: today,
  notes: notes || (existingIndex >= 0 ? releases[existingIndex].notes : ""),
  files,
};

if (existingIndex >= 0) releases[existingIndex] = entry;
else releases.unshift(entry);

const next = { ...manifest, updated: today, releases };

if (dryRun) {
  console.log("\n[dry] manifest.json:");
  console.log(JSON.stringify(next, null, 2));
  process.exit(0);
}

writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`\nmanifest.json обновлён: версия ${version}, файлов ${files.length}`);
console.log(`Не забудьте залить store-files/ на сервер: ${basename(storeDir)}/ -> /usr/share/nginx/store/`);
