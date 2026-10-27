#!/usr/bin/env python3
"""Add missing i18n keys batch 11: warehouse modals + raw materials + inventory."""
import json, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LANGS = ["ru", "uz", "en"]

def put(tree, dotted, value):
    parts = dotted.split(".")
    for p in parts[:-1]:
        tree = tree.setdefault(p, {})
    tree[parts[-1]] = value

def load(lang):
    path = os.path.join(ROOT, "src", "i18n", f"{lang}.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f), path

def save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

# (dotted_key, ru, uz, en)
NEW = [
    # common
    ("common.units_unavailable", "Единицы измерения недоступны", "O'lchov birliklari mavjud emas", "Units unavailable"),
    ("common.dishes_unavailable", "Блюда недоступны", "Taomlar mavjud emas", "Dishes unavailable"),
    ("common.archived_suffix", "архив", "arxiv", "archived"),
    ("common.number_sign", "№", "№", "№"),

    # inventorymodal errors
    ("pages.warehouse.inventorymodal.error.connection", "Нет связи с сервером. Проверьте подключение.", "Server bilan aloqa yo'q. Ulanishni tekshiring.", "No server connection. Check your connection."),
    ("pages.warehouse.inventorymodal.error.save_status", "Не удалось сохранить инвентаризацию (код {{status}}).", "Inventarizatsiyani saqlab bo'lmadi (kod {{status}}).", "Could not save inventory (code {{status}})."),
    ("pages.warehouse.inventorymodal.error.save_generic", "Не удалось сохранить инвентаризацию.", "Inventarizatsiyani saqlab bo'lmadi.", "Could not save inventory."),
    ("pages.warehouse.inventorymodal.error.load_stock", "Не удалось загрузить остатки.", "Qoldiqlarni yuklab bo'lmadi.", "Could not load stock."),
    ("pages.warehouse.inventorymodal.fact_aria", "Факт {{name}}", "Fakt {{name}}", "Actual {{name}}"),

    # rawmaterialspage
    ("pages.nomenclature.rawmaterialspage.error.name_required", "Укажите название.", "Nomini kiriting.", "Please enter a name."),
    ("pages.nomenclature.rawmaterialspage.error.unit_required", "Выберите единицу измерения.", "O'lchov birligini tanlang.", "Please select a unit."),
    ("pages.nomenclature.rawmaterialspage.error.avg_invalid", "Среднее количество — неотрицательное число.", "O'rtacha miqdor — manfiy bo'lmagan son.", "Average quantity must be a non-negative number."),
    ("pages.nomenclature.rawmaterialspage.error.deficit_invalid", "Порог дефицита — неотрицательное число.", "Defitsit chegarasi — manfiy bo'lmagan son.", "Deficit threshold must be a non-negative number."),
    ("pages.nomenclature.rawmaterialspage.error.loss_value_invalid", "Значение потери — неотрицательное число.", "Yo'qotish qiymati — manfiy bo'lmagan son.", "Loss value must be a non-negative number."),
    ("pages.nomenclature.rawmaterialspage.error.loss_percent_invalid", "Процент потери — от 0 до 100.", "Yo'qotish foizi — 0 dan 100 gacha.", "Loss percentage must be between 0 and 100."),
    ("pages.nomenclature.rawmaterialspage.error.loss_type_required", "Выберите тип потери.", "Yo'qotish turini tanlang.", "Please select a loss type."),
    ("pages.nomenclature.rawmaterialspage.error.save_generic", "Не удалось сохранить ингредиент.", "Ingredientni saqlab bo'lmadi.", "Could not save ingredient."),
    ("pages.nomenclature.rawmaterialspage.error.toggle_status", "Не удалось изменить статус ингредиента.", "Ingredient holatini o'zgartirib bo'lmadi.", "Could not change ingredient status."),
    ("pages.nomenclature.rawmaterialspage.error.load_products", "Не удалось загрузить продукты.", "Mahsulotlarni yuklab bo'lmadi.", "Could not load products."),
    ("pages.nomenclature.rawmaterialspage.error.load_dishes", "Не удалось загрузить блюда.", "Taomlarni yuklab bo'lmadi.", "Could not load dishes."),
    ("pages.nomenclature.rawmaterialspage.loss_label_amount", "Потери", "Yo'qotishlar", "Losses"),
    ("pages.nomenclature.rawmaterialspage.loss_label_percent", "Процент потери", "Yo'qotish foizi", "Loss percentage"),
    ("pages.nomenclature.rawmaterialspage.loss_label_generic", "Значение потери", "Yo'qotish qiymati", "Loss value"),
    ("pages.nomenclature.rawmaterialspage.placeholder_loss_amount", "Например: 0.2 (на 1 кг)", "Masalan: 0.2 (1 kg uchun)", "E.g. 0.2 (per 1 kg)"),
    ("pages.nomenclature.rawmaterialspage.placeholder_loss_percent", "Например: 10", "Masalan: 10", "E.g. 10"),
    ("pages.nomenclature.rawmaterialspage.placeholder_loss_generic", "Значение потери", "Yo'qotish qiymati", "Loss value"),
    ("pages.nomenclature.rawmaterialspage.editing", "Редактирование", "Tahrirlash", "Editing"),
    ("pages.nomenclature.rawmaterialspage.new_products", "Новые продукты", "Yangi mahsulotlar", "New products"),

    # rawingredientdishesdialog
    ("pages.nomenclature.rawingredientdishesdialog.error.save", "Не удалось сохранить использование.", "Ishlatishni saqlab bo'lmadi.", "Could not save usage."),
]

results = {}
for lang in LANGS:
    data, path = load(lang)
    added = 0
    for dotted, ru, uz, en in NEW:
        value = {"ru": ru, "uz": uz, "en": en}[lang]
        parts = dotted.split(".")
        node = data
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        if parts[-1] not in node:
            node[parts[-1]] = value
            added += 1
    save(path, data)
    results[lang] = added

print("добавлено:", results)
