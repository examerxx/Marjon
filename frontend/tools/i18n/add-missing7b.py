# -*- coding: utf-8 -*-
"""Патч каталога i18n, батч 7b: винительный падеж роли.

Заголовки карточки («Добавить …», «Изменить …») требуют винительного падежа,
а «Имя …», «Фото …» и текст ошибки — родительного. В русском эти формы
совпадают у всех ролей, кроме «моноблок»: «Добавить моноблок», но
«Имя моноблока». Поэтому две отдельные словарные ветки.

Скрипт идемпотентный: существующие ключи не перезаписываются.
Запуск: python tools/i18n/add-missing7b.py
"""
import json
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "src", "i18n")


def put(tree, dotted, value):
    parts = dotted.split(".")
    node = tree
    for part in parts[:-1]:
        nxt = node.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            node[part] = nxt
        node = nxt
    if parts[-1] in node:
        return False
    node[parts[-1]] = value
    return True


KEYS = {
    "staff.role_accusative.cashier": ("кассира", "kassir", "cashier"),
    "staff.role_accusative.waiter": ("официанта", "ofitsiant", "waiter"),
    "staff.role_accusative.monoblock": ("моноблок", "monoblok", "monoblock"),
    "staff.role_accusative.manager": ("менеджера", "menejer", "manager"),
    "staff.role_accusative.warehouse": ("завсклада", "ombor mudiri", "storekeeper"),
    "staff.role_accusative.kitchen": ("повара", "oshpaz", "cook"),
}


def main():
    added = {}
    for lang, idx in (("ru", 0), ("uz", 1), ("en", 2)):
        path = os.path.join(BASE, f"{lang}.json")
        with open(path, encoding="utf-8") as fh:
            tree = json.load(fh)
        count = 0
        for dotted, values in KEYS.items():
            if put(tree, dotted, values[idx]):
                count += 1
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(tree, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        added[lang] = count
    print("добавлено:", added)


if __name__ == "__main__":
    main()
