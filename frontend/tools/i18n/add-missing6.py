"""Батч 6: раздел сотрудников, номенклатура, склад, редактор чека, настройки."""
import json
import io
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "src", "i18n")

ADD = [
    # --- сотрудники: заголовки и статусы ---
    ("staff.list_title", "Список сотрудников", "Xodimlar ro'yxati", "Staff list"),
    ("staff.list_title_with_role", "Список сотрудников: {{role}}",
     "Xodimlar ro'yxati: {{role}}", "Staff list: {{role}}"),
    ("staff.base_access", "Базовый доступ", "Asosiy ruxsat", "Basic access"),
    ("staff.badge_active", "#активно", "#faol", "#active"),
    ("staff.badge_archived", "#архив", "#arxiv", "#archived"),
    ("staff.inactive", "Неактивен", "Faol emas", "Inactive"),
    ("staff.security", "Безопасность", "Xavfsizlik", "Security"),
    ("staff.attendance_shifts", "Смены сотрудников", "Xodimlar smenalari", "Staff shifts"),
    ("staff.pin_for_cash", "PIN для кассы", "Kassa uchun PIN", "PIN for the till"),
    ("staff.name_placeholder_cashier", "Имя кассира", "Kassir ismi", "Cashier name"),
    ("staff.name_placeholder_monoblock", "Имя моноблока", "Monoblok nomi", "Monoblock name"),
    ("staff.add_cashier", "Добавить кассира", "Kassir qo'shish", "Add cashier"),
    ("staff.add_waiter", "Добавить официанта", "Ofitsiant qo'shish", "Add waiter"),
    ("staff.add_monoblock", "Добавить моноблок", "Monoblok qo'shish", "Add monoblock"),
    ("staff.add_manager", "Добавить менеджера", "Menejer qo'shish", "Add manager"),
    ("staff.add_warehouse", "Добавить завсклада", "Omborchi qo'shish", "Add storekeeper"),
    ("staff.add_cook", "Добавить повара", "Oshpaz qo'shish", "Add cook"),
    ("staff.add_employee", "Добавить сотрудника", "Xodim qo'shish", "Add employee"),
    ("staff.edit_employee", "Изменить сотрудника", "Xodimni o'zgartirish", "Edit employee"),
    ("staff.saving", "Сохранение...", "Saqlanmoqda...", "Saving..."),

    # --- номенклатура ---
    ("pages.nomenclature.dishes_table_scroll", "Таблица блюд с прокруткой",
     "Taomlar jadvali (aylantirish bilan)", "Dishes table, scrollable"),
    ("pages.nomenclature.sales_table_scroll", "Таблица товаров с прокруткой",
     "Tovarlar jadvali (aylantirish bilan)", "Goods table, scrollable"),
    ("pages.nomenclature.goods_not_found", "Товары не найдены",
     "Tovarlar topilmadi", "No goods found"),
    ("pages.nomenclature.products_empty", "Продукты пока не добавлены.",
     "Mahsulotlar hali qo'shilmagan.", "No products added yet."),
    ("pages.nomenclature.semi_empty", "Полуфабрикаты пока не добавлены.",
     "Yarim tayyor mahsulotlar hali qo'shilmagan.", "No semi-finished items added yet."),
    ("pages.nomenclature.raw_categories_empty", "Категории продуктов пока не добавлены.",
     "Mahsulot kategoriyalari hali qo'shilmagan.", "No product categories added yet."),
    ("pages.nomenclature.categories_empty", "Категорий пока нет.",
     "Hozircha kategoriyalar yo'q.", "No categories yet."),

    # --- склад ---
    ("pages.warehousepage.stock_on_date", "Остатки на дату", "Sanadagi qoldiqlar", "Stock on date"),
    ("pages.warehousepage.new_transfer", "Новое перемещение +", "Yangi ko'chirish +", "New transfer +"),
    ("pages.warehousepage.from_warehouse", "Со склада", "Qaysi ombordan", "From warehouse"),
    ("pages.warehousepage.to_warehouse", "На склад", "Qaysi omborga", "To warehouse"),
    ("pages.warehousepage.items_count", "Кол-во позиций", "Pozitsiyalar soni", "Items count"),
    ("pages.warehousepage.inventory_scroll", "Инвентаризация с прокруткой",
     "Inventarizatsiya (aylantirish bilan)", "Inventory, scrollable"),
    ("pages.warehousepage.transfer_write_unavailable",
     "Изменения недоступны до подключения подтверждённого Warehouse write contract.",
     "O'zgartirishlar tasdiqlangan Warehouse write contract ulanmaguncha mavjud emas.",
     "Changes are unavailable until a confirmed Warehouse write contract is connected."),
    ("pages.warehousepage.write_off_unavailable",
     "Документы списания недоступны: подтверждённый backend contract не соответствует семантике этого экрана.",
     "Hisobdan chiqarish hujjatlari mavjud emas: tasdiqlangan backend contract bu ekran semantikasiga mos kelmaydi.",
     "Write-off documents are unavailable: the confirmed backend contract does not match this screen's semantics."),

    # --- редактор чека ---
    ("receipt.settings.separator_dashed_thin", "Прерывистые · Тонкие",
     "Uzilgan · Yupqa", "Dashed · Thin"),
    ("receipt.settings.logo", "Логотип", "Logotip", "Logo"),
    ("receipt.settings.choose_logo", "Выбрать логотип", "Logotip tanlash", "Choose logo"),
    ("receipt.settings.establishment_name", "Название заведения",
     "Muassasa nomi", "Establishment name"),
    ("receipt.settings.order_number_and_type", "Номер и тип заказа",
     "Buyurtma raqami va turi", "Order number and type"),
    ("receipt.settings.items_section", "Позиции", "Pozitsiyalar", "Items"),
    ("receipt.settings.service_fee", "Сервисный сбор", "Xizmat haqi", "Service fee"),
    ("receipt.settings.bottom_order_number", "Нижний номер заказа",
     "Pastki buyurtma raqami", "Bottom order number"),
    ("receipt.settings.items_text", "Текст позиций", "Pozitsiyalar matni", "Items text"),
    ("receipt.settings.orders_with_total", "Заказы (показать сумму)",
     "Buyurtmalar (summani ko'rsatish)", "Orders (show total)"),

    ("receipt.preview.order_number", "Номер заказа:", "Buyurtma raqami:", "Order number:"),
    ("receipt.preview.order_type", "Тип заказа:", "Buyurtma turi:", "Order type:"),
    ("receipt.preview.table_number", "Номер стола:", "Stol raqami:", "Table number:"),
    ("receipt.preview.cashier", "Кассир:", "Kassir:", "Cashier:"),
    ("receipt.preview.date", "Дата:", "Sana:", "Date:"),
    ("receipt.preview.time", "Время:", "Vaqt:", "Time:"),
    ("receipt.preview.table", "Стол:", "Stol:", "Table:"),
    ("receipt.preview.waiter", "Официант:", "Ofitsiant:", "Waiter:"),
    ("receipt.preview.service_12", "Обслуга 12%", "Xizmat 12%", "Service 12%"),
    ("receipt.preview.demo_dish_1", "Плов чайханский", "Choyxona palovi", "Chaikhana pilaf"),
    ("receipt.preview.demo_dish_2", "Салат Ачичук", "Achichuk salati", "Achichuk salad"),
    ("receipt.preview.demo_note_1", "Без казы, Острый соус отдельно",
     "Qazi yo'q, achchiq sous alohida", "No kazy, hot sauce on the side"),
    ("receipt.preview.demo_note_2", "Меньше соли", "Kamroq tuz", "Less salt"),
    ("receipt.preview.demo_note_3", "Один без моркови", "Bittasi sabzisiz", "One without carrot"),
    ("receipt.preview.demo_note_4", "Без лука в салате", "Salatda piyozsiz", "No onion in the salad"),

    # --- профиль и принтеры ---
    ("pages.settings.settingsprofilepage.ochistit_vse_otchety",
     "Очистить все отчеты", "Barcha hisobotlarni tozalash", "Clear all reports"),
    ("pages.settings.settingsprofilepage.ochistit_istoriyu_produktov",
     "Очистить историю продуктов", "Mahsulotlar tarixini tozalash", "Clear product history"),
    ("pages.settings.settingsprinterspage.redaktirovat_printer",
     "Редактировать «{{name}}»", "«{{name}}» ni tahrirlash", "Edit “{{name}}”"),
    ("pages.settings.settingsprinterspage.udalit_printer",
     "Удалить «{{name}}»", "«{{name}}» ni o'chirish", "Delete “{{name}}”"),

    # --- отчёты ---
    ("report_period.cancelled", "Период отчёта по отменённым блюдам",
     "Bekor qilingan taomlar hisoboti davri", "Cancelled dishes report period"),
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
