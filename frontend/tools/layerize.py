#!/usr/bin/env python3
"""
Преобразует CSS в две каскадные группы без !important.

Семантика !important — это отдельный верхний слой каскада. Ровно это выражает
@layer, поэтому преобразование даёт побайтово тот же результат каскада:

    @layer marjon-base, marjon-important;
    @layer marjon-base      { обычные декларации, исходный порядок }
    @layer marjon-important { бывшие !important, исходный порядок }

Внутри каждого слоя порядок и специфичность сохранены, между слоями решает
объявленный порядок слоёв — как раньше решал флаг важности.

  python3 layerize.py kafe|admin [--dry]
"""
from __future__ import annotations
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cssx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_LAYER = "marjon-base"
IMP_LAYER = "marjon-important"


def blank(text: str, lo: int, hi: int) -> bool:
    return re.sub(r"/\*.*?\*/", "", text[lo:hi], flags=re.S).strip() == ""


def drop_empty(text: str, rel: str) -> str:
    """Убрать правила без деклараций и опустевшие @-блоки."""
    for _ in range(8):
        sh = cssx.Stylesheet(text, rel)
        dead = [(r.start, r.end) for r in sh.rules
                if not r.in_keyframes and not r.decls and blank(text, r.brace + 1, r.end - 1)]
        if not dead:
            break
        text = cssx.apply_deletions(text, dead)
    for _ in range(8):
        changed = False
        out, i = [], 0
        while True:
            m = re.compile(r"@(?:media|supports|container)[^{}]*\{").search(text, i)
            if not m:
                out.append(text[i:])
                break
            depth, j = 1, m.end()
            while j < len(text) and depth:
                if text[j] == "{": depth += 1
                elif text[j] == "}": depth -= 1
                j += 1
            if re.sub(r"/\*.*?\*/", "", text[m.end():j - 1], flags=re.S).strip() == "":
                out.append(text[i:m.start()]); changed = True
            else:
                out.append(text[i:j])
            i = j
        text = "".join(out)
        if not changed:
            break
    return re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", text)


def split(text: str, rel: str):
    """Вернуть (base, important) — два текста без !important."""
    sh = cssx.Stylesheet(text, rel)

    # --- base: выкинуть важные декларации ---
    spans = []
    for r in sh.rules:
        if r.in_keyframes:
            continue
        imp = [d for d in r.decls if d.important]
        if not imp:
            continue
        if len(imp) == len(r.decls):
            spans.append((r.start, r.end))
        else:
            spans.extend((d.start, d.end) for d in imp)
    base = drop_empty(cssx.apply_deletions(text, spans), rel)

    # --- important: выкинуть обычные декларации и все @keyframes ---
    spans = []
    kf_ranges = []
    for r in sh.rules:
        if r.in_keyframes:
            continue
        norm = [d for d in r.decls if not d.important]
        if not norm:
            continue
        if len(norm) == len(r.decls):
            spans.append((r.start, r.end))
        else:
            spans.extend((d.start, d.end) for d in norm)
    # блоки @keyframes целиком
    for m in re.finditer(r"@(?:-webkit-)?keyframes\s+[\w-]+\s*\{", text):
        depth, j = 1, m.end()
        while j < len(text) and depth:
            if text[j] == "{": depth += 1
            elif text[j] == "}": depth -= 1
            j += 1
        kf_ranges.append((m.start(), j))
    imp_text = cssx.apply_deletions(text, spans + kf_ranges)
    imp_text = re.sub(r"\s*!\s*important", "", imp_text, flags=re.I)
    imp = drop_empty(imp_text, rel)
    return base, imp


def has_decls(text: str, rel: str) -> bool:
    """Есть ли в тексте хоть одна декларация (комментарии не в счёт)."""
    sh = cssx.Stylesheet(text, rel)
    return any(r.decls for r in sh.rules)


def wrap(inner: str, layer: str) -> str:
    if not inner.strip():
        return ""
    body = "\n".join(("  " + ln if ln.strip() else ln) for ln in inner.split("\n"))
    return f"@layer {layer} {{\n{body}\n}}\n"


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "kafe"
    dry = "--dry" in sys.argv
    files = cssx.KAFE if which == "kafe" else cssx.ADMIN
    files = [f for f in files if "restore" not in f]

    print(f"{'файл':40s} {'было':>9s} {'base':>9s} {'important':>10s}")
    print("-" * 72)
    first = True
    for rel in files:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        text = open(p, encoding="utf-8").read()
        if "@layer" in text:
            print(f"{rel:40s}  уже преобразован — пропуск")
            first = False
            continue
        base, imp = split(text, rel)
        head = ""
        if first:
            head = (f"/* Порядок каскадных слоёв. Объявлен один раз, до первого использования.\n"
                    f"   {IMP_LAYER} заменяет прежний !important: бьёт {BASE_LAYER}\n"
                    f"   независимо от специфичности, как раньше это делал флаг. */\n"
                    f"@layer {BASE_LAYER}, {IMP_LAYER};\n\n")
            first = False
        keep_imp = has_decls(imp, rel)
        out = head + wrap(base, BASE_LAYER) + ("\n" + wrap(imp, IMP_LAYER) if keep_imp else "")
        if not dry:
            open(p, "w", encoding="utf-8").write(out)
        print(f"{rel:40s} {len(text):9d} {len(base):9d} {len(imp):10d}")


if __name__ == "__main__":
    main()
