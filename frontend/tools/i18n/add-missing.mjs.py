"""Разовый патч каталогов i18n: добавляет ключи, которых не хватало для
дашборда, фильтра дат и виджета поддержки.

Идемпотентен: существующие ключи не перезаписывает, только сообщает.
"""
import json
import io
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "src", "i18n")

# (путь ключа, ru, uz, en)
ADD = [
    # общие
    ("common.unknown", "Неизвестно", "Noma'lum", "Unknown"),
    ("common.send", "Отправить", "Yuborish", "Send"),
    ("common.soon", "Скоро", "Tez orada", "Soon"),

    # фильтр дат
    ("date_picker.this_year", "Этот год", "Bu yil", "This year"),
    ("date_picker.date_from", "Дата с", "Sanadan", "Date from"),
    ("date_picker.date_to", "Дата по", "Sanagacha", "Date to"),

    # дашборд: пустые состояния
    ("pages.dashboard.dashboardcards.novye_zakazy_budut_otobrazhatsya_zdes",
     "Новые заказы будут отображаться здесь.",
     "Yangi buyurtmalar shu yerda ko'rinadi.",
     "New orders will appear here."),
    ("pages.dashboard.dashboardcards.posle_pervyh_zakazov_zdes_poyavyatsya_samye_prodavaemye_pozitsii",
     "После первых заказов здесь появятся самые продаваемые позиции.",
     "Birinchi buyurtmalardan so'ng bu yerda eng ko'p sotilgan pozitsiyalar paydo bo'ladi.",
     "Your best-selling items will appear here after the first orders."),

    # дашборд: диалоги и таблицы
    ("pages.dashboard.dashboarddialogs.zakaza", "№ заказа", "Buyurtma №", "Order №"),
    ("pages.dashboard.dashboarddialogs.data_i_vremya_oplaty",
     "Дата и время оплаты", "To'lov sanasi va vaqti", "Payment date and time"),
    ("pages.dashboard.dashboarddialogs.mesto", "Место", "Joy", "Place"),
    ("pages.dashboard.dashboarddialogs.summa", "Сумма", "Summa", "Amount"),
    ("pages.dashboard.dashboarddialogs.status", "Статус", "Holat", "Status"),
    ("pages.dashboard.dashboarddialogs.oplacheno_zakazov",
     "Оплачено заказов", "To'langan buyurtmalar", "Paid orders"),
    ("pages.dashboard.dashboarddialogs.denezhnyy_prihod",
     "Денежный приход", "Pul kirimi", "Cash income"),
    ("pages.dashboard.dashboarddialogs.sredniy_chek",
     "Средний чек", "O'rtacha chek", "Average check"),
    ("pages.dashboard.dashboarddialogs.chistaya_pribyl",
     "Чистая прибыль", "Sof foyda", "Net profit"),
    ("pages.dashboard.dashboarddialogs.zakazy", "Заказы", "Buyurtmalar", "Orders"),
    ("pages.dashboard.dashboarddialogs.ne_udalos_zagruzit_prodazhi",
     "Не удалось загрузить продажи", "Savdolarni yuklab bo'lmadi", "Failed to load sales"),
    ("pages.dashboard.dashboarddialogs.ne_udalos_zagruzit_zakazy",
     "Не удалось загрузить заказы", "Buyurtmalarni yuklab bo'lmadi", "Failed to load orders"),
    ("pages.dashboard.dashboarddialogs.ne_udalos_zagruzit_sredniy_chek",
     "Не удалось загрузить средний чек", "O'rtacha chekni yuklab bo'lmadi", "Failed to load average check"),
    ("pages.dashboard.dashboarddialogs.otkryt_chek_zakaza",
     "Открыть чек заказа", "Buyurtma chekini ochish", "Open order receipt"),
    ("pages.dashboard.dashboarddialogs.net_dannyh", "Нет данных", "Ma'lumot yo'q", "No data"),
]


def load(lang):
    with io.open(os.path.join(BASE, f"{lang}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def save(lang, data):
    with io.open(os.path.join(BASE, f"{lang}.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


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


trees = {lang: load(lang) for lang in ("ru", "uz", "en")}
added = {"ru": 0, "uz": 0, "en": 0}
for key, ru, uz, en in ADD:
    for lang, value in (("ru", ru), ("uz", uz), ("en", en)):
        if put(trees[lang], key, value):
            added[lang] += 1

for lang in ("ru", "uz", "en"):
    save(lang, trees[lang])

print("добавлено:", added)
