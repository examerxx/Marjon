#!/usr/bin/env python3
"""
Запрещает возврат !important.

Считает настоящие декларации, а не упоминания: в CSS разбор идёт парсером,
который игнорирует комментарии; в JSX ищется только внутри строк со стилями.

Возвращает 1, если хоть один найден.
"""
from __future__ import annotations
import sys, os, re, glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cssx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

found = []

# --- CSS: только реальные декларации ---
for p in sorted(glob.glob(os.path.join(ROOT, "src/**/*.css"), recursive=True)):
    sh = cssx.Stylesheet(open(p, encoding="utf-8").read(), p)
    for r in sh.rules:
        for d in r.decls:
            if d.important:
                found.append((os.path.relpath(p, ROOT), d.line, f"{d.prop}: {d.value}"))

# --- JSX/JS: вне комментариев ---
for pat in ("src/**/*.jsx", "src/**/*.js"):
    for p in sorted(glob.glob(os.path.join(ROOT, pat), recursive=True)):
        text = open(p, encoding="utf-8").read()
        # вырезать комментарии, чтобы не ловить пояснения
        clean = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
        clean = re.sub(r"//[^\n]*", "", clean)
        for m in re.finditer(r"!\s*important", clean, re.I):
            line = clean.count("\n", 0, m.start()) + 1
            snippet = clean.split("\n")[line - 1].strip()[:70]
            found.append((os.path.relpath(p, ROOT), line, snippet))

if found:
    print(f"✗ Найдено !important: {len(found)}")
    print("  Он запрещён — приоритет задаётся слоями @layer marjon-base / marjon-important.")
    for f, line, what in found[:15]:
        print(f"    {f}:{line}  {what}")
    if len(found) > 15:
        print(f"    … ещё {len(found) - 15}")
    sys.exit(1)

print("✓ !important отсутствует")
