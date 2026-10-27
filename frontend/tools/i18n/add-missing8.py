# -*- coding: utf-8 -*-
"""Патч каталога i18n, батч 8: общий диалог подтверждения архивации.

Один и тот же блок (Номенклатура → Блюда и Меню → Товары) держал текст
литералами: заголовок, вопрос, подпись кнопки и её состояние «в процессе».
Ключи общие, потому что разметка и поведение общие — отличается только
существительное (блюдо/товар).

Скрипт идемпотентный: существующие ключи не перезаписываются.
Запуск: python tools/i18n/add-missing8.py
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
    "common.confirm.archive_title": ("Архивация", "Arxivlash", "Archiving"),
    "common.confirm.restore_title": ("Восстановление", "Tiklash", "Restoring"),
    "common.confirm.archive_busy": ("Архивация...", "Arxivlanmoqda...", "Archiving..."),
    "common.confirm.restore_busy": ("Восстановление...", "Tiklanmoqda...", "Restoring..."),
    "common.confirm.archive_action": ("Архивировать", "Arxivlash", "Archive"),
    "common.confirm.restore_action": ("Восстановить", "Tiklash", "Restore"),
    "common.confirm.archive_dish": ("Архивировать блюдо?", "Taomni arxivlaysizmi?", "Archive the dish?"),
    "common.confirm.restore_dish": ("Восстановить блюдо?", "Taomni tiklaysizmi?", "Restore the dish?"),
    "common.confirm.archive_goods": ("Архивировать товар?", "Tovarni arxivlaysizmi?", "Archive the product?"),
    "common.confirm.restore_goods": ("Восстановить товар?", "Tovarni tiklaysizmi?", "Restore the product?"),
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
