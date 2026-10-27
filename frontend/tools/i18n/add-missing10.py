# -*- coding: utf-8 -*-
"""Патч каталога i18n, батч 10: модалки/дроверы, которые не видны при обходе
маршрутов (они закрыты по умолчанию).

Затронуто: «Добавить категорию», «Добавить блюдо/сет», «Добавить продукты»,
«Добавить склад», «Создать инвентаризацию», пустое состояние прихода.

Скрипт идемпотентный: существующие ключи не перезаписываются.
Запуск: python tools/i18n/add-missing10.py
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
    # --- Надзаголовки «Новый/Новая» (род зависит от существительного) --------
    "eyebrow.new_male": ("Новый", "Yangi", "New"),
    "eyebrow.new_female": ("Новая", "Yangi", "New"),
    # --- Переключатели «включено/выключено» ---------------------------------
    "common.enabled": ("Включено", "Yoqilgan", "Enabled"),
    "common.disabled": ("Выключено", "O'chirilgan", "Disabled"),
    # --- Общие подписи селектов --------------------------------------------
    "common.warehouses_unavailable": (
        "Склады недоступны",
        "Omborlar mavjud emas",
        "Warehouses unavailable",
    ),
    "common.categories_unavailable": (
        "Категории недоступны",
        "Kategoriyalar mavjud emas",
        "Categories unavailable",
    ),
    "common.printers_unavailable": (
        "Принтеры недоступны",
        "Printerlar mavjud emas",
        "Printers unavailable",
    ),
    "common.loss_value": ("Значение потери", "Yo'qotish qiymati", "Loss value"),
    # --- Категории ---------------------------------------------------------
    "pages.categoriespage.dobavit_kategoriyu_produktov": (
        "Добавить категорию продуктов",
        "Mahsulot kategoriyasini qo'shish",
        "Add product category",
    ),
    "pages.categoriespage.redaktirovat_kategoriyu_produktov": (
        "Редактировать категорию продуктов",
        "Mahsulot kategoriyasini tahrirlash",
        "Edit product category",
    ),
    # --- Карточка блюда/сета ------------------------------------------------
    "pages.nomenclature.dishesdialogs.dobavit_blyudo": (
        "Добавить блюдо",
        "Taom qo'shish",
        "Add dish",
    ),
    "pages.nomenclature.dishesdialogs.redaktirovat_blyudo": (
        "Редактировать блюдо",
        "Taomni tahrirlash",
        "Edit dish",
    ),
    "pages.nomenclature.dishesdialogs.novoe_blyudo": (
        "Новое блюдо",
        "Yangi taom",
        "New dish",
    ),
    "pages.nomenclature.dishesdialogs.dobavit_set": ("Добавить сет", "Set qo'shish", "Add set"),
    "pages.nomenclature.dishesdialogs.redaktirovat_set": (
        "Редактировать сет",
        "Setni tahrirlash",
        "Edit set",
    ),
    "pages.nomenclature.dishesdialogs.novyy_set": ("Новый сет", "Yangi set", "New set"),
    "pages.nomenclature.dishesdialogs.zagruzit_foto": (
        "Загрузить фото",
        "Surat yuklash",
        "Upload photo",
    ),
    "pages.nomenclature.dishesdialogs.zamenit_foto": (
        "Заменить фото",
        "Suratni almashtirish",
        "Replace photo",
    ),
    "pages.nomenclature.dishesdialogs.foto_blyuda": (
        "Фото блюда",
        "Taom surati",
        "Dish photo",
    ),
    "pages.nomenclature.dishesdialogs.novoe_foto_blyuda": (
        "Новое фото блюда",
        "Taomning yangi surati",
        "New dish photo",
    ),
    # --- Карточка продукта --------------------------------------------------
    "pages.nomenclature.rawmaterialspage.dobavit_produkty": (
        "Добавить продукты",
        "Mahsulot qo'shish",
        "Add products",
    ),
    "pages.nomenclature.rawmaterialspage.redaktirovat_produkty": (
        "Редактировать продукты",
        "Mahsulotlarni tahrirlash",
        "Edit products",
    ),
    # --- Склад --------------------------------------------------------------
    "pages.warehouse.warehousemodal.dobavit_sklad": (
        "Добавить склад",
        "Ombor qo'shish",
        "Add warehouse",
    ),
    "pages.warehouse.warehousemodal.redaktirovat_sklad": (
        "Редактировать склад",
        "Omborni tahrirlash",
        "Edit warehouse",
    ),
    "pages.warehouse.warehousemodal.udalit_sklad": (
        "Удалить склад?",
        "Ombor o'chirilsinmi?",
        "Delete warehouse?",
    ),
    "pages.warehouse.warehousemodal.udalenie": ("Удаление", "O'chirish", "Deletion"),
    "pages.warehouse.warehousemodal.arhivirovano": (
        "Архивировано",
        "Arxivlangan",
        "Archived",
    ),
    # --- Приход: пустой список продуктов ------------------------------------
    "pages.warehousepage.products_empty_hint": (
        "Продукты пока не добавлены. Добавьте их в разделе Склад → Продукты.",
        "Mahsulotlar hali qo'shilmagan. Ularni Ombor → Mahsulotlar bo'limida qo'shing.",
        "No products added yet. Add them under Warehouse → Products.",
    ),
    "pages.warehousepage.new_warehouse": ("Новый склад", "Yangi ombor", "New warehouse"),
    # --- Склад: ошибки инвентаризации --------------------------------------
    "pages.warehouse.inventorymodal.error.select_warehouse": (
        "Выберите склад.",
        "Omborni tanlang.",
        "Select a warehouse.",
    ),
    "pages.warehouse.inventorymodal.error.no_items": (
        "Введите фактическое количество хотя бы для одной позиции.",
        "Kamida bitta pozitsiya uchun haqiqiy miqdorni kiriting.",
        "Enter the actual quantity for at least one item.",
    ),
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
