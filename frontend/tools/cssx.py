#!/usr/bin/env python3
"""
cssx — минимальный, но честный CSS-парсер с точными байтовыми смещениями.

Задача: уметь (а) построить реестр «кто выигрывает каскад», (б) удалить
конкретные декларации хирургически, не трогая остальной байт-в-байт текст.

Не пытается быть полным CSS-парсером. Умеет: правила, вложенные at-правила,
комментарии, строки, url(), @keyframes (помечает, чтобы не трогали).
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Decl:
    prop: str
    value: str            # без !important
    important: bool
    start: int            # смещение начала декларации в файле
    end: int              # смещение сразу за ';' (или за последним символом)
    line: int
    rule: "Rule" = field(repr=False, default=None)

    @property
    def key(self):
        return (self.rule.context, self.rule.sel_norm, self.prop)


@dataclass
class Rule:
    selector: str
    sel_norm: str
    selectors: List[str]          # разбитый по запятым, нормализованный
    context: str                  # склеенный at-контекст (@media ...)
    at_stack: List[str]
    start: int                    # начало селектора
    brace: int                    # позиция '{'
    end: int                      # позиция сразу за '}'
    line: int
    order: int
    file: str
    decls: List[Decl] = field(default_factory=list)
    in_keyframes: bool = False


def _first_significant(s: str) -> int:
    """Индекс первого символа, который не пробел и не комментарий."""
    i, n = 0, len(s)
    while i < n:
        if s[i] in " \t\r\n\f":
            i += 1
        elif s.startswith("/*", i):
            e = s.find("*/", i + 2)
            i = n if e == -1 else e + 2
        else:
            return i
    return 0


def _norm(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*([>+~,])\s*", r"\1", s)
    return s.strip()


class Stylesheet:
    def __init__(self, text: str, filename: str, order_base: int = 0):
        self.text = text
        self.file = filename
        self.rules: List[Rule] = []
        self._parse(order_base)

    # ---------- парсер ----------
    def _parse(self, order_base: int):
        s = self.text
        n = len(s)
        i = 0
        line = 1
        buf_start = 0
        at_stack: List[str] = []
        kf_depth: Optional[int] = None
        order = order_base
        pending = ""

        def skip_ws_comments(j):
            nonlocal line
            while j < n:
                if s[j] == "\n":
                    line += 1
                    j += 1
                elif s[j] in " \t\r\f":
                    j += 1
                elif s.startswith("/*", j):
                    e = s.find("*/", j + 2)
                    e = n if e == -1 else e + 2
                    line += s.count("\n", j, e)
                    j = e
                else:
                    break
            return j

        while i < n:
            c = s[i]

            if c == "\n":
                line += 1
                i += 1
                pending += c
                continue

            if s.startswith("/*", i):
                e = s.find("*/", i + 2)
                e = n if e == -1 else e + 2
                line += s.count("\n", i, e)
                pending += s[i:e]
                i = e
                continue

            if c in "\"'":
                q = c
                j = i + 1
                while j < n:
                    if s[j] == "\\":
                        j += 2
                        continue
                    if s[j] == q:
                        j += 1
                        break
                    j += 1
                pending += s[i:j]
                i = j
                continue

            if c == "{":
                # Комментарии в преамбуле не должны маскировать at-правило:
                # "/* note */ @media (...) {" — это @media, а не селектор.
                sel_raw = re.sub(r"/\*.*?\*/", " ", pending, flags=re.S).strip()
                sel_line = line
                sel_start = i - len(pending) + _first_significant(pending)
                pending = ""

                if sel_raw.startswith("@"):
                    head = sel_raw.split()[0].lower()
                    if "keyframes" in head:
                        if kf_depth is None:
                            kf_depth = len(at_stack)
                    at_stack.append(sel_raw)
                    i += 1
                    continue

                # обычное правило — читаем блок
                depth = 1
                j = i + 1
                while j < n and depth > 0:
                    ch = s[j]
                    if ch == "\n":
                        line += 1
                    elif s.startswith("/*", j):
                        e = s.find("*/", j + 2)
                        e = n if e == -1 else e + 2
                        line += s.count("\n", j, e)
                        j = e
                        continue
                    elif ch in "\"'":
                        q = ch
                        k = j + 1
                        while k < n:
                            if s[k] == "\\":
                                k += 2
                                continue
                            if s[k] == q:
                                k += 1
                                break
                            k += 1
                        j = k
                        continue
                    elif ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                    j += 1

                ctx = " ".join(a for a in at_stack if a.startswith(("@media", "@supports", "@container")))
                rule = Rule(
                    selector=sel_raw,
                    sel_norm=_norm(sel_raw),
                    selectors=[_norm(x) for x in _split_sel(sel_raw)],
                    context=_norm(ctx),
                    at_stack=list(at_stack),
                    start=sel_start,
                    brace=i,
                    end=j,
                    line=sel_line,
                    order=order,
                    file=self.file,
                    in_keyframes=(kf_depth is not None),
                )
                order += 1
                self._parse_decls(rule, i + 1, j - 1)
                self.rules.append(rule)
                i = j
                continue

            if c == "}":
                if at_stack:
                    at_stack.pop()
                    if kf_depth is not None and len(at_stack) <= kf_depth:
                        kf_depth = None
                pending = ""
                i += 1
                continue

            # at-инструкция без блока (@import, @charset, @layer a, b;).
            # Комментарий перед ней не должен её маскировать.
            if c == ";" and re.sub(r"/\*.*?\*/", " ", pending, flags=re.S).strip().startswith("@"):
                pending = ""
                i += 1
                continue

            pending += c
            i += 1

        self.max_order = order

    def _parse_decls(self, rule: Rule, lo: int, hi: int):
        s = self.text
        i = lo
        line = rule.line
        while i < hi:
            i2 = i
            # пропустить пробелы/комментарии
            while i2 < hi:
                if s[i2] in " \t\r\n\f":
                    i2 += 1
                elif s.startswith("/*", i2):
                    e = s.find("*/", i2 + 2)
                    i2 = hi if e == -1 else e + 2
                else:
                    break
            if i2 >= hi:
                break
            start = i2
            # прочитать до ';' на нулевой глубине скобок
            depth = 0
            j = i2
            while j < hi:
                ch = s[j]
                if s.startswith("/*", j):
                    e = s.find("*/", j + 2)
                    j = hi if e == -1 else e + 2
                    continue
                if ch in "\"'":
                    q = ch
                    k = j + 1
                    while k < hi:
                        if s[k] == "\\":
                            k += 2
                            continue
                        if s[k] == q:
                            k += 1
                            break
                        k += 1
                    j = k
                    continue
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                elif ch == ";" and depth == 0:
                    break
                j += 1
            raw = s[start:j]
            end = j + 1 if j < hi and s[j] == ";" else j
            body = re.sub(r"/\*.*?\*/", "", raw, flags=re.S).strip()
            if body and ":" in body:
                p, _, v = body.partition(":")
                p = p.strip().lower()
                imp = bool(re.search(r"!\s*important", v, re.I))
                v2 = re.sub(r"!\s*important", "", v, flags=re.I).strip()
                if p and not p.startswith("@"):
                    d = Decl(
                        prop=p,
                        value=_norm_val(v2),
                        important=imp,
                        start=start,
                        end=end,
                        line=line + s.count("\n", lo, start),
                        rule=rule,
                    )
                    rule.decls.append(d)
            i = end


def _split_sel(sel: str) -> List[str]:
    """Разбить список селекторов по запятым, уважая скобки :not(a, b)."""
    out, buf, depth = [], "", 0
    for ch in sel:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(buf)
            buf = ""
        else:
            buf += ch
    if buf.strip():
        out.append(buf)
    return out


def _norm_val(v: str) -> str:
    v = re.sub(r"\s+", " ", v).strip().rstrip(";").strip()
    return v


# ---------- specificity ----------
_RE_ID = re.compile(r"#[\w-]+")
_RE_CLASS = re.compile(r"\.[\w-]+")
_RE_ATTR = re.compile(r"\[[^\]]*\]")
_RE_PSEUDO_EL = re.compile(r"::[\w-]+")
_RE_PSEUDO_CL = re.compile(r":(?!:)([\w-]+)")
_RE_TAG = re.compile(r"(^|[\s>+~(])([a-zA-Z][\w-]*)")

_ZERO_PSEUDO = {"not", "is", "where", "has", "matches", "any"}


def specificity(sel: str):
    """Возвращает (a, b, c). Достаточно точно для нашей задачи."""
    s = _norm(sel)
    a = len(_RE_ID.findall(s))
    inner = ""
    # :not()/:is()/:has() — считаем содержимое, сам псевдокласс не считаем
    for m in re.finditer(r":(?:not|is|has|matches|any)\(([^()]*)\)", s):
        inner += " " + m.group(1)
    s2 = re.sub(r":(?:where)\([^()]*\)", " ", s)
    s2 = re.sub(r":(?:not|is|has|matches|any)\(([^()]*)\)", " ", s2)
    b = len(_RE_CLASS.findall(s2)) + len(_RE_ATTR.findall(s2))
    pcs = [p for p in _RE_PSEUDO_CL.findall(re.sub(r"::[\w-]+", "", s2)) if p not in _ZERO_PSEUDO]
    b += len(pcs)
    c = len(_RE_PSEUDO_EL.findall(s2))
    tmp = re.sub(r"::?[\w-]+(\([^()]*\))?", " ", s2)
    tmp = _RE_CLASS.sub(" ", tmp)
    tmp = _RE_ID.sub(" ", tmp)
    tmp = _RE_ATTR.sub(" ", tmp)
    c += len([t for t in re.findall(r"(?:^|[\s>+~])([a-zA-Z][\w-]*)", tmp) if t.lower() != "important"])
    if inner.strip():
        ia, ib, ic = specificity(inner)
        a, b, c = a + ia, b + ib, c + ic
    return (a, b, c)


def key_token(sel: str) -> str:
    """Последний «ключевой» компонент селектора — прокси для «какой элемент задевает»."""
    s = _norm(sel)
    s = re.sub(r"::?[\w-]+(\([^()]*\))?", "", s)
    parts = re.split(r"[ >+~]", s.strip())
    parts = [p for p in parts if p]
    return parts[-1] if parts else s


def load(paths, root=""):
    """Загрузить список файлов в порядке каскада."""
    sheets = []
    order = 0
    import os
    for p in paths:
        full = os.path.join(root, p) if root else p
        if not os.path.exists(full):
            continue
        txt = open(full, encoding="utf-8", errors="replace").read()
        sh = Stylesheet(txt, p, order)
        order = sh.max_order + 1
        sheets.append(sh)
    return sheets


def apply_deletions(text: str, spans):
    """Удалить байтовые диапазоны [(start,end),...] из текста."""
    spans = sorted(spans, key=lambda x: x[0])
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    out = []
    prev = 0
    for a, b in merged:
        out.append(text[prev:a])
        prev = b
    out.append(text[prev:])
    return "".join(out)


KAFE = [
    "src/styles/marjon-tokens.css",
    "src/styles/brand.css",
    "src/styles/dashboard.css",
    "src/styles/topbar-widgets.css",
    "src/styles/forms.css",
    "src/styles/tables.css",
    "src/styles/staff-pos.css",
    "src/styles/responsive.css",
    "src/styles/app.css",
    "src/styles/dashboard-curve.css",
    "src/styles/loader.css",
    "src/styles/react-overrides.css",
    "src/styles/receipt.css",
    "src/styles/auth.css",
    "src/styles/login-extras.css",
    "src/styles/marjon-restore.css",
]
ADMIN = ["src/admin/styles.css", "src/admin/restore.css"]
