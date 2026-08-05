#!/usr/bin/env python3
"""
Расщепляет правила, где часть селекторов мертва, а часть жива.

    .a, .b { color: red; }        # color мёртв для .a, жив для .b
    ->
    .b { color: red; }

Декларация убирается из общего правила и переносится в новое, сразу следом,
только с живыми селекторами. Порядок каскада сохраняется: новое правило стоит
вплотную за исходным, между ними ничего вклиниться не может.

  python3 split-dead.py <dead.json> [--dry]
"""
from __future__ import annotations
import sys, os, json, re
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cssx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    dead = json.load(open(sys.argv[1], encoding="utf-8"))["dead"]
    dry = "--dry" in sys.argv

    # (file, line, prop) -> множество мёртвых селекторных частей
    dead_parts = defaultdict(set)
    for d in dead:
        dead_parts[(d["file"], d["line"], d["prop"])].add(cssx._norm(d["sel"]))

    by_file = defaultdict(list)
    for (f, line, prop), sels in dead_parts.items():
        by_file[f].append((line, prop, sels))

    print(f"{'файл':40s} {'расщеплено':>11s} {'новых правил':>13s}")
    print("-" * 68)
    tot_split = tot_new = 0

    for rel, items in sorted(by_file.items()):
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            continue
        text = open(path, encoding="utf-8").read()
        sh = cssx.Stylesheet(text, rel)

        rules_by_line = defaultdict(list)
        for r in sh.rules:
            rules_by_line[r.line].append(r)

        # rule -> {alive_key: [(prop, value)]}
        plans = {}        # id(rule) -> (rule, {alive_key: [(prop,val)]})
        spans = []
        nsplit = 0

        for line, prop, dsels in items:
            for r in rules_by_line.get(line, []):
                decls = [d for d in r.decls if d.prop == prop]
                if not decls:
                    continue
                parts = [s for s in r.selectors if s]
                alive = [s for s in parts if cssx._norm(s) not in dsels]
                if not alive or len(alive) == len(parts):
                    continue      # либо всё мертво (обработает prune), либо всё живо
                key = ",".join(alive)
                slot = plans.setdefault(id(r), (r, {}))[1]
                slot.setdefault(key, [])
                for d in decls:
                    slot[key].append((d.prop, d.value))
                    spans.append((d.start, d.end))
                    nsplit += 1

        if not plans:
            continue

        # вставки: текст нового правила сразу за исходным
        inserts = []
        nnew = 0
        for r, groups in plans.values():
            chunk = ""
            for alive_key, decls in groups.items():
                body = "".join(f"  {p}: {v};\n" for p, v in decls)
                chunk += f"\n{alive_key} {{\n{body}}}\n"
                nnew += 1
            inserts.append((r.end, chunk))

        # применяем: сначала удаления, потом вставки (с пересчётом смещений)
        new = cssx.apply_deletions(text, spans)
        # пересчитать позиции вставок с учётом удалённых байт
        merged = sorted(spans)
        def shift(pos):
            off = 0
            for a, b in merged:
                if b <= pos:
                    off += b - a
                elif a < pos < b:
                    off += pos - a
            return pos - off
        for pos, chunk in sorted(inserts, key=lambda x: -x[0]):
            p = shift(pos)
            new = new[:p] + chunk + new[p:]

        # подчистить опустевшие правила
        for _ in range(4):
            sh2 = cssx.Stylesheet(new, rel)
            empt = [(x.start, x.end) for x in sh2.rules
                    if not x.in_keyframes and not x.decls
                    and re.sub(r"/\*.*?\*/", "", new[x.brace + 1:x.end - 1], flags=re.S).strip() == ""]
            if not empt:
                break
            new = cssx.apply_deletions(new, empt)
        new = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", new)

        if not dry:
            open(path, "w", encoding="utf-8").write(new)
        tot_split += nsplit; tot_new += nnew
        print(f"{rel:40s} {nsplit:11d} {nnew:13d}")

    print("-" * 68)
    print(f"{'ИТОГО':40s} {tot_split:11d} {tot_new:13d}")


if __name__ == "__main__":
    main()
