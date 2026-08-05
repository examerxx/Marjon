#!/usr/bin/env python3
"""
Радикальное удаление: вырезать ВСЕ декларации с !important целиком.

Дополнительно:
  - удаляет правила, оставшиеся без деклараций;
  - удаляет @media/@supports, оставшиеся без правил;
  - сохраняет «реестр дизайн-намерения» — всё удалённое, с селектором,
    контекстом, файлом и строкой, чтобы переписывать не вслепую.

Запуск:
  python3 delete_important.py kafe   [--dry]
  python3 delete_important.py admin  [--dry]
"""
from __future__ import annotations
import sys, os, json, re
sys.path.insert(0, os.path.dirname(__file__))
import cssx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = os.path.join(ROOT, ".cssaudit")


def blank_outside(text: str, lo: int, hi: int) -> bool:
    """Остался ли внутри диапазона только пробел/комментарии."""
    frag = text[lo:hi]
    frag = re.sub(r"/\*.*?\*/", "", frag, flags=re.S)
    return frag.strip() == ""


def process_file(path: str, rel: str, ledger: list, dry: bool):
    text = open(path, encoding="utf-8").read()
    sh = cssx.Stylesheet(text, rel)

    spans = []
    removed_decls = 0
    removed_rules = 0

    for r in sh.rules:
        if r.in_keyframes:
            continue
        imp = [d for d in r.decls if d.important]
        if not imp:
            continue

        for d in imp:
            ledger.append({
                "file": rel, "line": d.line, "ctx": r.context,
                "sel": r.selector.strip(), "prop": d.prop, "val": d.value,
            })
        removed_decls += len(imp)

        if len(imp) == len(r.decls):
            # правило целиком состоит из important — сносим правило
            spans.append((r.start, r.end))
            removed_rules += 1
        else:
            for d in imp:
                spans.append((d.start, d.end))

    new = cssx.apply_deletions(text, spans)

    # --- вторым проходом: убрать правила, ставшие пустыми, и пустые @media ---
    for _ in range(6):
        sh2 = cssx.Stylesheet(new, rel)
        dead = []
        for r in sh2.rules:
            if r.in_keyframes:
                continue
            if not r.decls and blank_outside(new, r.brace + 1, r.end - 1):
                dead.append((r.start, r.end))
        if not dead:
            break
        removed_rules += len(dead)
        new = cssx.apply_deletions(new, dead)

    # пустые at-блоки: @media ... { }  (в т.ч. с комментариями внутри)
    for _ in range(6):
        changed = False
        out = []
        i = 0
        while True:
            m = re.compile(r"@(?:media|supports|container)[^{}]*\{").search(new, i)
            if not m:
                out.append(new[i:])
                break
            # найти парную скобку
            depth = 1
            j = m.end()
            while j < len(new) and depth > 0:
                if new[j] == "{":
                    depth += 1
                elif new[j] == "}":
                    depth -= 1
                j += 1
            inner = new[m.end(): j - 1]
            if re.sub(r"/\*.*?\*/", "", inner, flags=re.S).strip() == "":
                out.append(new[i:m.start()])
                changed = True
            else:
                out.append(new[i:j])
            i = j
        new = "".join(out)
        if not changed:
            break

    # схлопнуть образовавшиеся дыры из пустых строк
    new = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", new)

    if not dry:
        open(path, "w", encoding="utf-8").write(new)

    return removed_decls, removed_rules, len(text), len(new)


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "kafe"
    dry = "--dry" in sys.argv
    files = cssx.KAFE if which == "kafe" else cssx.ADMIN

    ledger = []
    print(f"{'файл':42s} {'-декл':>7s} {'-правил':>8s} {'было':>9s} {'стало':>9s}  {'ужатие':>7s}")
    print("-" * 92)
    tD = tR = tB = tA = 0
    for rel in files:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        d, r, b, a = process_file(p, rel, ledger, dry)
        tD += d; tR += r; tB += b; tA += a
        if d or r:
            print(f"{rel:42s} {d:7d} {r:8d} {b:9d} {a:9d}  {100*(b-a)/max(b,1):6.1f}%")
    print("-" * 92)
    print(f"{'ИТОГО':42s} {tD:7d} {tR:8d} {tB:9d} {tA:9d}  {100*(tB-tA)/max(tB,1):6.1f}%")

    os.makedirs(AUDIT, exist_ok=True)
    lp = os.path.join(AUDIT, f"ledger-{which}.json")
    if not dry:
        json.dump(ledger, open(lp, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"\nреестр удалённого: {lp} ({len(ledger)} записей)")


if __name__ == "__main__":
    main()
