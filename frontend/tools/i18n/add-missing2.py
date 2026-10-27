"""Второй батч ключей: KPI-карточки дашборда и таблица способов оплаты."""
import json
import io
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "src", "i18n")

ADD = [
    ("common.unavailable", "Недоступно", "Mavjud emas", "Unavailable"),
    ("common.calculation", "Расчёт", "Hisob", "Calculation"),
    ("common.noncash", "Безнал", "Naqd pulsiz", "Non-cash"),
    ("common.no_payments_for_day", "Нет оплат за выбранный день",
     "Tanlangan kun uchun to'lovlar yo'q", "No payments for the selected day"),

    ("pages.dashboard.analyticsdata.zavershennyh_i_oplachennyh",
     "Завершённых и оплаченных", "Yakunlangan va to'langan", "Completed and paid"),
    ("pages.dashboard.analyticsdata.sebestoimost_oplachennyh_pozitsiy_rychitaetsya",
     "Себестоимость оплаченных позиций (вычитается)",
     "To'langan pozitsiyalar tannarxi (ayiriladi)",
     "Cost of paid items (deducted)"),
    ("pages.dashboard.analyticsdata.vyruchka_prihod_minus_sebestoimost",
     "Выручка = приход − себестоимость",
     "Tushum = kirim − tannarx",
     "Revenue = income − cost"),
    ("pages.dashboard.analyticsdata.denezhnyy_prihod_pokazyvaet_postupleniya_proshedshie_cherez_oplatu",
     "Денежный приход показывает поступления, прошедшие через оплату.",
     "Pul kirimi to'lov orqali o'tgan tushumlarni ko'rsatadi.",
     "Cash income shows the receipts that went through payment."),
    ("pages.dashboard.analyticsdata.denezhnyy_prihod_minus_istoricheskaya_sebestoimost_oplachennyh_pozitsiy",
     "Денежный приход минус историческая себестоимость оплаченных позиций.",
     "Pul kirimi minus to'langan pozitsiyalarning tarixiy tannarxi.",
     "Cash income minus the historical cost of paid items."),
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
