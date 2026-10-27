"""Пятый батч: топбар, Z-отчёт, aria-подписи периодов отчётов."""
import json
import io
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "src", "i18n")

ADD = [
    ("topbar.balance", "Баланс", "Balans", "Balance"),
    ("topbar.balance_unavailable", "Баланс недоступен", "Balans mavjud emas", "Balance unavailable"),
    ("topbar.notifications_none", "Уведомлений нет", "Bildirishnomalar yo'q", "No notifications"),
    ("topbar.events_none", "Событий пока нет", "Hozircha voqealar yo'q", "No events yet"),

    ("pages.zreportpage.vyberite_hotya_by_odnu_pozitsiyu",
     "Выберите хотя бы одну позицию", "Kamida bitta pozitsiyani tanlang", "Select at least one item"),
    ("pages.zreportpage.ne_vybrano", "Не выбрано", "Tanlanmagan", "Not selected"),

    ("app.razdel_otzyvov", "Раздел отзывов будет показывать обратную связь клиентов.",
     "Sharhlar bo'limi mijozlar fikrini ko'rsatadi.",
     "The reviews section will show customer feedback."),

    ("report_period.orders", "Период отчёта по заказам", "Buyurtmalar hisoboti davri", "Orders report period"),
    ("report_period.sales", "Период отчёта о продажах", "Savdo hisoboti davri", "Sales report period"),
    ("report_period.dishes", "Период отчёта по блюдам", "Taomlar hisoboti davri", "Dishes report period"),
    ("report_period.tables", "Период отчёта по столам", "Stollar hisoboti davri", "Tables report period"),
    ("report_period.waiters", "Период отчёта по официантам", "Ofitsiantlar hisoboti davri", "Waiters report period"),
    ("report_period.z_report", "Период Z-отчёта", "Z-hisobot davri", "Z-report period"),
    ("report_period.documents", "Период документов", "Hujjatlar davri", "Documents period"),
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
