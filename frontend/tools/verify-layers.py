#!/usr/bin/env python3
"""
Доказательство эквивалентности преобразования в @layer.

Сверяет попарно, декларация к декларации:
  обычные декларации оригинала  ==  содержимое слоя marjon-base
  важные декларации оригинала   ==  содержимое слоя marjon-important

Порядок, селекторы, медиаконтексты и значения должны совпасть полностью.
Расхождение хотя бы в одной паре — преобразование неверно.

  python3 verify-layers.py kafe|admin <baseRef>
"""
from __future__ import annotations
import sys, os, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cssx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(ROOT)


def layer_of(rule) -> str:
    for a in rule.at_stack:
        if a.startswith("@layer"):
            return a.replace("@layer", "").strip()
    return ""


def tuples_original(text, rel):
    """(normal, important) — списки кортежей в порядке следования."""
    sh = cssx.Stylesheet(text, rel)
    norm, imp = [], []
    for r in sh.rules:
        if r.in_keyframes:
            continue
        for d in r.decls:
            t = (r.context, r.sel_norm, d.prop, d.value)
            (imp if d.important else norm).append(t)
    return norm, imp


def tuples_layered(text, rel):
    sh = cssx.Stylesheet(text, rel)
    base, imp, stray = [], [], []
    for r in sh.rules:
        if r.in_keyframes:
            continue
        lay = layer_of(r)
        for d in r.decls:
            t = (r.context, r.sel_norm, d.prop, d.value)
            if d.important:
                stray.append(t)
            elif lay == "marjon-base":
                base.append(t)
            elif lay == "marjon-important":
                imp.append(t)
            else:
                stray.append(("ВНЕ СЛОЯ",) + t)
    return base, imp, stray


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "kafe"
    ref = sys.argv[2]
    files = [f for f in (cssx.KAFE if which == "kafe" else cssx.ADMIN) if "restore" not in f]

    total_ok = True
    tot_n = tot_i = 0
    print(f"{'файл':40s} {'обычных':>9s} {'важных':>8s}  вердикт")
    print("-" * 76)
    for rel in files:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        orig = subprocess.run(["git", "-C", REPO, "show", f"{ref}:frontend/{rel}"],
                              capture_output=True).stdout.decode("utf-8", "replace")
        new = open(p, encoding="utf-8").read()
        n0, i0 = tuples_original(orig, rel)
        nb, ib, stray = tuples_layered(new, rel)

        problems = []
        if stray:
            problems.append(f"{len(stray)} деклараций вне слоёв или с !important")
        if n0 != nb:
            problems.append(f"обычные не совпали ({len(n0)} против {len(nb)})")
            for a, b in zip(n0, nb):
                if a != b:
                    problems.append(f"   первое расхождение: {a} != {b}")
                    break
        if i0 != ib:
            problems.append(f"важные не совпали ({len(i0)} против {len(ib)})")
            for a, b in zip(i0, ib):
                if a != b:
                    problems.append(f"   первое расхождение: {a} != {b}")
                    break
        tot_n += len(n0); tot_i += len(i0)
        ok = not problems
        total_ok &= ok
        print(f"{rel:40s} {len(n0):9d} {len(i0):8d}  {'СОВПАЛО' if ok else 'РАСХОЖДЕНИЕ'}")
        for x in problems:
            print(f"      {x}")

    # ни одного !important не должно остаться
    left = 0
    for rel in files:
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            sh = cssx.Stylesheet(open(p, encoding="utf-8").read(), rel)
            left += sum(1 for r in sh.rules for d in r.decls if d.important)

    print("-" * 76)
    print(f"{'ИТОГО':40s} {tot_n:9d} {tot_i:8d}")
    print(f"!important осталось: {left}")
    print()
    print("ЭКВИВАЛЕНТНОСТЬ ДОКАЗАНА" if total_ok and left == 0 else "ЕСТЬ РАСХОЖДЕНИЯ")
    sys.exit(0 if (total_ok and left == 0) else 1)


if __name__ == "__main__":
    main()
