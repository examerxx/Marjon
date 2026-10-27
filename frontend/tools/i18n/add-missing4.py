"""Четвёртый батч: виджет поддержки и страны в селекторе телефона."""
import json
import io
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "src", "i18n")

ADD = [
    ("components.supportwidget.otkryt_podderzhku", "Открыть поддержку", "Yordamni ochish", "Open support"),
    ("components.supportwidget.zayavka_prinyata", "Заявка принята", "So'rov qabul qilindi", "Request received"),
    ("components.supportwidget.svyazhemsya_s_vami_po_ukazannomu_nomeru",
     "Свяжемся с вами по указанному номеру.",
     "Ko'rsatilgan raqam orqali siz bilan bog'lanamiz.",
     "We will contact you at the number provided."),
    ("components.supportwidget.novaya_zayavka", "Новая заявка", "Yangi so'rov", "New request"),
    ("components.supportwidget.otpravka", "Отправка...", "Yuborilmoqda...", "Sending..."),

    ("pages.staff.staffphone.kyrgyzstan", "Кыргызстан", "Qirg'iziston", "Kyrgyzstan"),
    ("pages.staff.staffphone.azerbaijan", "Азербайджан", "Ozarbayjon", "Azerbaijan"),
    ("pages.staff.staffphone.georgia", "Грузия", "Gruziya", "Georgia"),
    ("pages.staff.staffphone.ukraine", "Украина", "Ukraina", "Ukraine"),
    ("pages.staff.staffphone.belarus", "Беларусь", "Belarus", "Belarus"),
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
