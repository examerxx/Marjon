"""Третий батч: календарь и фильтр дат (месяцы, дни недели, подписи полей)."""
import json
import io
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "src", "i18n")

ADD = [
    ("date_picker.select_date", "Выберите дату", "Sanani tanlang", "Select a date"),
    ("date_picker.period_start", "Начало периода", "Davr boshlanishi", "Period start"),
    ("date_picker.period_end", "Конец периода", "Davr tugashi", "Period end"),

    ("date_picker.mon_short_jan", "Янв", "Yan", "Jan"),
    ("date_picker.mon_short_feb", "Фев", "Fev", "Feb"),
    ("date_picker.mon_short_mar", "Мар", "Mar", "Mar"),
    ("date_picker.mon_short_apr", "Апр", "Apr", "Apr"),
    ("date_picker.mon_short_may", "Май", "May", "May"),
    ("date_picker.mon_short_jun", "Июн", "Iyn", "Jun"),
    ("date_picker.mon_short_jul", "Июл", "Iyl", "Jul"),
    ("date_picker.mon_short_aug", "Авг", "Avg", "Aug"),
    ("date_picker.mon_short_sep", "Сен", "Sen", "Sep"),
    ("date_picker.mon_short_oct", "Окт", "Okt", "Oct"),
    ("date_picker.mon_short_nov", "Ноя", "Noy", "Nov"),
    ("date_picker.mon_short_dec", "Дек", "Dek", "Dec"),

    ("date_picker.mon_jan", "Январь", "Yanvar", "January"),
    ("date_picker.mon_feb", "Февраль", "Fevral", "February"),
    ("date_picker.mon_mar", "Март", "Mart", "March"),
    ("date_picker.mon_apr", "Апрель", "Aprel", "April"),
    ("date_picker.mon_may", "Май", "May", "May"),
    ("date_picker.mon_jun", "Июнь", "Iyun", "June"),
    ("date_picker.mon_jul", "Июль", "Iyul", "July"),
    ("date_picker.mon_aug", "Август", "Avgust", "August"),
    ("date_picker.mon_sep", "Сентябрь", "Sentabr", "September"),
    ("date_picker.mon_oct", "Октябрь", "Oktabr", "October"),
    ("date_picker.mon_nov", "Ноябрь", "Noyabr", "November"),
    ("date_picker.mon_dec", "Декабрь", "Dekabr", "December"),

    ("date_picker.wd_mon", "Пн", "Du", "Mon"),
    ("date_picker.wd_tue", "Вт", "Se", "Tue"),
    ("date_picker.wd_wed", "Ср", "Ch", "Wed"),
    ("date_picker.wd_thu", "Чт", "Pa", "Thu"),
    ("date_picker.wd_fri", "Пт", "Ju", "Fri"),
    ("date_picker.wd_sat", "Сб", "Sh", "Sat"),
    ("date_picker.wd_sun", "Вс", "Ya", "Sun"),
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
