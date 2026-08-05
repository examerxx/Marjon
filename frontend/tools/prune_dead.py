#!/usr/bin/env python3
"""
Удаляет «мёртвые» декларации, найденные find-dead.mjs.

Защита: если исходное правило разделено между несколькими селекторами
(`.a, .b { ... }`), декларация удаляется только когда мертвы ВСЕ части.
Частичные случаи выводятся отдельно — их разбираем руками.

  python3 prune_dead.py <dead.json> [--dry]
"""
import sys, os, json, re
from collections import defaultdict
sys.path.insert(0, os.path.dirname(__file__))
import cssx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    dead_path = sys.argv[1]
    dry = "--dry" in sys.argv
    dead = json.load(open(dead_path, encoding="utf-8"))["dead"]

    # (file, line, prop) -> набор мёртвых селекторных частей
    dead_parts = defaultdict(set)
    for d in dead:
        dead_parts[(d["file"], d["line"], d["prop"])].add(cssx._norm(d["sel"]))

    by_file = defaultdict(list)
    for (f, line, prop), sels in dead_parts.items():
        by_file[f].append((line, prop, sels))

    total_del = total_skip = 0
    print(f"{'файл':38s} {'удалено':>8s} {'пропущено':>10s}")
    print("-" * 60)
    skipped_detail = []

    for rel, items in sorted(by_file.items()):
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        text = open(path, encoding="utf-8").read()
        sh = cssx.Stylesheet(text, rel)

        # индекс правил по строке
        rules_by_line = defaultdict(list)
        for r in sh.rules:
            rules_by_line[r.line].append(r)

        spans, ndel, nskip = [], 0, 0
        for line, prop, dsels in items:
            cands = rules_by_line.get(line, [])
            for r in cands:
                decls = [d for d in r.decls if d.prop == prop]
                if not decls:
                    continue
                parts = {cssx._norm(s) for s in r.selectors if s}
                if not parts.issubset(dsels):
                    nskip += 1
                    skipped_detail.append((rel, line, prop, sorted(parts - dsels)[:2]))
                    continue
                for d in decls:
                    spans.append((d.start, d.end))
                    ndel += 1

        if spans:
            new = cssx.apply_deletions(text, spans)
            # подчистить правила, ставшие пустыми
            for _ in range(4):
                sh2 = cssx.Stylesheet(new, rel)
                empt = []
                for r in sh2.rules:
                    if r.in_keyframes:
                        continue
                    inner = re.sub(r"/\*.*?\*/", "", new[r.brace + 1:r.end - 1], flags=re.S)
                    if not r.decls and inner.strip() == "":
                        empt.append((r.start, r.end))
                if not empt:
                    break
                new = cssx.apply_deletions(new, empt)
            new = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", new)
            if not dry:
                open(path, "w", encoding="utf-8").write(new)

        total_del += ndel
        total_skip += nskip
        print(f"{rel:38s} {ndel:8d} {nskip:10d}")

    print("-" * 60)
    print(f"{'ИТОГО':38s} {total_del:8d} {total_skip:10d}")
    if skipped_detail:
        print(f"\nПропущено (правило делится с живыми селекторами) — первые 8:")
        for rel, line, prop, alive in skipped_detail[:8]:
            print(f"  {rel}:{line} {prop}  живые части: {alive}")


if __name__ == "__main__":
    main()
