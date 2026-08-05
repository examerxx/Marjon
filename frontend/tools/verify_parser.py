#!/usr/bin/env python3
"""
Санити-чек парсера. Проверяет не только счётчики, но и то, что реально ломается:
  1. смещения деклараций указывают на декларации;
  2. at-правила распознаны как at-правила (комментарий перед @media не маскирует его);
  3. диапазоны правил не пересекаются;
  4. баланс скобок сохраняется ПОСЛЕ симуляции удаления — главный тест;
  5. specificity.
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
import cssx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAIL = 0


def brace_depth(t: str):
    """Глубина скобок с учётом строк и комментариев. Возвращает (итог, номера строк ухода в минус)."""
    depth = 0
    line = 1
    i = 0
    n = len(t)
    neg = []
    while i < n:
        c = t[i]
        if c == "\n":
            line += 1; i += 1; continue
        if t.startswith("/*", i):
            e = t.find("*/", i + 2); e = n if e < 0 else e + 2
            line += t.count("\n", i, e); i = e; continue
        if c in "\"'":
            q = c; j = i + 1
            while j < n:
                if t[j] == "\\": j += 2; continue
                if t[j] == q: j += 1; break
                j += 1
            i = j; continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth < 0:
                neg.append(line); depth = 0
        i += 1
    return depth, neg


def check(paths, label):
    global FAIL
    print(f"\n===== {label} =====")
    sheets = cssx.load(paths, ROOT)
    for sh in sheets:
        problems = []
        raw_imp = len(re.findall(r"!\s*important",
                     re.sub(r"/\*.*?\*/", "", sh.text, flags=re.S), re.I))
        p_imp = sum(1 for r in sh.rules for d in r.decls if d.important)
        if raw_imp != p_imp:
            problems.append(f"important {p_imp} != {raw_imp} в файле")

        # 2. at-правила не должны попадать в селекторы
        bad_at = [r for r in sh.rules if re.search(r"@(media|supports|keyframes|container)", r.selector)]
        if bad_at:
            problems.append(f"{len(bad_at)} правил с @-словом в селекторе, напр. {bad_at[0].selector[:60]!r}")

        # 3. пересечения диапазонов правил
        spans = sorted([(r.start, r.end) for r in sh.rules])
        for a, b in zip(spans, spans[1:]):
            if b[0] < a[1]:
                problems.append(f"пересечение диапазонов {a} и {b}")
                break

        # 1. смещения деклараций
        for r in sh.rules:
            for d in r.decls:
                frag = sh.text[d.start:d.end].lower()
                if d.prop not in frag:
                    problems.append(f"смещение {sh.file}:{d.line} prop={d.prop}")
                    break
            if problems and problems[-1].startswith("смещение"):
                break

        # 4. ГЛАВНОЕ: симулируем удаление всех important и проверяем скобки
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
        new = cssx.apply_deletions(sh.text, spans)
        d0, neg0 = brace_depth(sh.text)
        d1, neg1 = brace_depth(new)
        if d1 != 0 or neg1:
            problems.append(f"ПОСЛЕ УДАЛЕНИЯ скобки разъехались: глубина={d1}, минус на строках {neg1[:6]}")
        if d0 != 0 or neg0:
            problems.append(f"исходник несбалансирован: глубина={d0} {neg0[:4]}")

        status = "OK" if not problems else "ПРОБЛЕМЫ"
        print(f"  {sh.file:40s} rules={len(sh.rules):5d} decls={sum(len(r.decls) for r in sh.rules):6d} imp={p_imp:5d}  {status}")
        for p in problems:
            print(f"      -> {p}")
            FAIL += 1


check(cssx.KAFE, "KAFE")
check(cssx.ADMIN, "ADMIN")

# round-trip
sh = cssx.Stylesheet(open(os.path.join(ROOT, "src/styles/react-overrides.css"), encoding="utf-8").read(), "t")
assert cssx.apply_deletions(sh.text, []) == sh.text
print("\nround-trip: OK")

# специальный кейс: комментарий перед @media
probe = """
/* note */
@media (min-width: 1025px) {
  .a { color: red !important; }
}
.b { color: blue; }
"""
p = cssx.Stylesheet(probe, "probe")
sels = [r.selector for r in p.rules]
ok = sels == [".a", ".b"] and "min-width" in p.rules[0].context and p.rules[1].context == ""
print(f"комментарий перед @media: {'OK' if ok else 'СЛОМАНО -> ' + repr(sels) + ' ctx=' + repr([r.context for r in p.rules])}")
if not ok:
    FAIL += 1

cases = [("*", (0,0,0)), ("li", (0,0,1)), ("ul li", (0,0,2)), (".a", (0,1,0)),
         ("#id", (1,0,0)), ("a:hover", (0,1,1)), ("li::before", (0,0,2)),
         (".dashboard-shell .kpi-grid--premium .premium-kpi__icon", (0,3,0)),
         (".a:not(.b)", (0,2,0)), ('input[type="text"]', (0,1,1))]
for sel, exp in cases:
    got = cssx.specificity(sel)
    if got != exp:
        print(f"  specificity FAIL {sel!r}: {got} != {exp}"); FAIL += 1

print(f"\n{'ВСЁ ЧИСТО' if FAIL == 0 else f'ОБНАРУЖЕНО ПРОБЛЕМ: {FAIL}'}")
sys.exit(1 if FAIL else 0)
