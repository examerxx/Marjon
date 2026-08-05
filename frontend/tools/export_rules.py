#!/usr/bin/env python3
"""Выгрузить разобранный CSS в JSON для расчёта каскада в Node."""
import sys, os, json, re
sys.path.insert(0, os.path.dirname(__file__))
import cssx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".cssaudit")


def key_of(sel: str):
    """Правый ключевой компонент: (тип, значение) для бакетирования."""
    s = cssx._norm(sel)
    # убрать псевдоэлементы/классы с конца для определения ключа
    s = re.sub(r"::[\w-]+", "", s)
    parts = re.split(r"[ >+~]", s.strip())
    parts = [p for p in parts if p]
    if not parts:
        return ("*", "*")
    last = parts[-1]
    ids = re.findall(r"#([\w-]+)", last)
    if ids:
        return ("id", ids[-1])
    # класс: берём последний класс вне :not(...)
    outside = re.sub(r":(?:not|is|has|where|matches|any)\([^()]*\)", "", last)
    cls = re.findall(r"\.([\w-]+)", outside)
    if cls:
        return ("class", cls[-1])
    cls2 = re.findall(r"\.([\w-]+)", last)
    if cls2:
        return ("class", cls2[-1])
    tag = re.match(r"^([a-zA-Z][\w-]*)", last)
    if tag:
        return ("tag", tag.group(1).lower())
    return ("*", "*")


def export(paths, label):
    sheets = cssx.load(paths, ROOT)
    out = []
    for sh in sheets:
        for r in sh.rules:
            if r.in_keyframes or not r.decls:
                continue
            for sel in r.selectors:
                if not sel:
                    continue
                out.append({
                    "sel": sel,
                    "ctx": r.context,
                    "ord": r.order,
                    "spec": cssx.specificity(sel),
                    "key": key_of(sel),
                    "file": r.file,
                    "line": r.line,
                    "layer": next((a.replace("@layer", "").strip()
                                   for a in r.at_stack if a.startswith("@layer")), ""),
                    "d": [[d.prop, d.value, 1 if d.important else 0] for d in r.decls],
                })
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, f"rules-{label}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    nd = sum(len(x["d"]) for x in out)
    ni = sum(1 for x in out for d in x["d"] if d[2])
    print(f"{label}: селекторных правил={len(out)} деклараций={nd} important={ni} -> {p}")


export(cssx.KAFE, "kafe")
export(cssx.ADMIN, "admin")
