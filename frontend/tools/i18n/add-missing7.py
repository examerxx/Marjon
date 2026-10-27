# -*- coding: utf-8 -*-
"""Патч каталога i18n, батч 7: раздел «Сотрудники» (карточка, таблица,
модалка, журналы активности) и остатки страницы «Меню» (продажи).

Скрипт идемпотентный: существующие ключи не перезаписываются.
Запуск: python tools/i18n/add-missing7.py
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


# dotted key -> (ru, uz, en)
KEYS = {
    # --- Таблица сотрудников -------------------------------------------------
    "staff.printer_title": ("Принтер: {{name}}", "Printer: {{name}}", "Printer: {{name}}"),
    # --- Роли в косвенном падеже (для «Добавить …», «Имя …», «Фото …») -------
    "staff.role_genitive.cashier": ("кассира", "kassir", "cashier"),
    "staff.role_genitive.waiter": ("официанта", "ofitsiant", "waiter"),
    "staff.role_genitive.monoblock": ("моноблока", "monoblok", "monoblock"),
    "staff.role_genitive.manager": ("менеджера", "menejer", "manager"),
    "staff.role_genitive.warehouse": ("завсклада", "ombor mudiri", "storekeeper"),
    "staff.role_genitive.kitchen": ("повара", "oshpaz", "cook"),
    # --- Заголовки/плейсхолдеры карточки ------------------------------------
    "staff.add_title": ("Добавить {{role}}", "{{role}} qo'shish", "Add {{role}}"),
    "staff.edit_title": ("Изменить {{role}}", "{{role}}ni o'zgartirish", "Edit {{role}}"),
    "staff.name_placeholder": ("Имя {{role}}", "{{role}} ismi", "{{role}} name"),
    "staff.photo_alt": ("Фото {{role}}", "{{role}} surati", "{{role}} photo"),
    "staff.editing": ("Редактирование", "Tahrirlash", "Editing"),
    "staff.new_employee": ("Новый сотрудник", "Yangi xodim", "New employee"),
    "staff.new_password": ("Новый пароль", "Yangi parol", "New password"),
    "staff.password": ("Пароль", "Parol", "Password"),
    "staff.pin_for_kitchen": ("PIN для кухни", "Oshxona PIN kodi", "PIN for kitchen"),
    "staff.status_active": ("Активный", "Faol", "Active"),
    "staff.status_archived": ("Архив", "Arxiv", "Archived"),
    "staff.printer_inactive": ("{{name}} (не активен)", "{{name}} (faol emas)", "{{name}} (inactive)"),
    "staff.printers_unavailable": ("Принтеры недоступны", "Printerlar mavjud emas", "Printers unavailable"),
    "staff.save": ("Сохранить", "Saqlash", "Save"),
    "staff.add": ("Добавить", "Qo'shish", "Add"),
    # --- Сводка прав (колонка «Права доступа») ------------------------------
    "staff.perm.delete_dishes": ("Удаление блюд", "Taomlarni o'chirish", "Delete dishes"),
    "staff.perm.change_marking_code": (
        "Изменение кода маркировки",
        "Markirovka kodini o'zgartirish",
        "Change marking code",
    ),
    "staff.perm.takeaway_at_table": ("Заказ на вынос", "Olib ketishga buyurtma", "Takeaway order"),
    "staff.perm.change_order_type": (
        "Изменение типа заказа",
        "Buyurtma turini o'zgartirish",
        "Change order type",
    ),
    "staff.perm.close_bill": ("Закрытие счета", "Hisobni yopish", "Close bill"),
    "staff.perm.manage_orders": ("Управление заказами", "Buyurtmalarni boshqarish", "Manage orders"),
    "staff.perm.open_cash_drawer": (
        "Открытие денежного ящика",
        "Pul yashigini ochish",
        "Open cash drawer",
    ),
    "staff.perm.view_closed_orders": (
        "Просмотр закрытых заказов",
        "Yopilgan buyurtmalarni ko'rish",
        "View closed orders",
    ),
    "staff.perm.view_finance": ("Просмотр финансов", "Moliyani ko'rish", "View finance"),
    "staff.perm.approve_attendance": (
        "Посещаемость (приход/уход)",
        "Davomat (kelish/ketish)",
        "Attendance (in/out)",
    ),
    # --- Ошибки карточки сотрудника -----------------------------------------
    "staff.error.load_failed": (
        "Не удалось загрузить сотрудников.",
        "Xodimlarni yuklab bo'lmadi.",
        "Could not load employees.",
    ),
    "staff.error.name_and_phone": (
        "Укажите имя и номер телефона {{role}}.",
        "{{role}} ismi va telefon raqamini kiriting.",
        "Enter the {{role}} name and phone number.",
    ),
    "staff.error.password_min": (
        "Пароль должен содержать минимум 4 символа.",
        "Parol kamida 4 belgidan iborat bo'lishi kerak.",
        "Password must be at least 4 characters.",
    ),
    "staff.error.pin_four": ("PIN — ровно 4 цифры.", "PIN — aynan 4 raqam.", "PIN must be exactly 4 digits."),
    "staff.error.pin_required_kitchen": (
        "PIN — 4 цифры: без него повар не войдёт на кухню.",
        "PIN — 4 raqam: usiz oshpaz oshxonaga kira olmaydi.",
        "PIN must be 4 digits: without it the cook cannot enter the kitchen.",
    ),
    "staff.error.email_and_role": (
        "Укажите email и допустимую роль сотрудника.",
        "Email va ruxsat etilgan xodim rolini kiriting.",
        "Enter an email and a valid employee role.",
    ),
    "staff.error.photo_type": (
        "Фото: поддерживаются только jpg, png, webp.",
        "Surat: faqat jpg, png, webp qo'llab-quvvatlanadi.",
        "Photo: only jpg, png, webp are supported.",
    ),
    "staff.error.photo_size": (
        "Фото больше 5 МБ — выберите файл меньше.",
        "Surat 5 MB dan katta — kichikroq fayl tanlang.",
        "Photo is larger than 5 MB — choose a smaller file.",
    ),
    "staff.error.save": ("Ошибка сохранения", "Saqlashda xatolik", "Save error"),
    "staff.error.photo_upload": (
        "Сотрудник сохранён, но фото загрузить не удалось. Попробуйте ещё раз.",
        "Xodim saqlandi, lekin suratni yuklab bo'lmadi. Yana urinib ko'ring.",
        "The employee was saved, but the photo could not be uploaded. Try again.",
    ),
    "staff.error.archive": (
        "Не удалось архивировать сотрудника.",
        "Xodimni arxivlab bo'lmadi.",
        "Could not archive the employee.",
    ),
    "staff.error.restore": (
        "Не удалось восстановить сотрудника.",
        "Xodimni tiklab bo'lmadi.",
        "Could not restore the employee.",
    ),
    "staff.error.phone_registered": (
        "Этот номер уже зарегистрирован. Используйте другой номер телефона (Phone already registered).",
        "Bu raqam allaqachon ro'yxatdan o'tgan. Boshqa telefon raqamdan foydalaning (Phone already registered).",
        "This number is already registered. Use another phone number (Phone already registered).",
    ),
    "staff.error.phone_in_use": (
        "Этот номер уже используется другим сотрудником (Phone already in use).",
        "Bu raqam boshqa xodim tomonidan ishlatilmoqda (Phone already in use).",
        "This number is already used by another employee (Phone already in use).",
    ),
    # --- Журналы активности -------------------------------------------------
    "staff.activity.load_failed": (
        "Не удалось загрузить данные активности сотрудников.",
        "Xodimlar faoliyati ma'lumotlarini yuklab bo'lmadi.",
        "Could not load employee activity data.",
    ),
    "staff.activity.loading_attendance": (
        "Загрузка посещаемости...",
        "Davomat yuklanmoqda...",
        "Loading attendance...",
    ),
    "staff.activity.loading_login_history": (
        "Загрузка истории входов...",
        "Kirishlar tarixi yuklanmoqda...",
        "Loading login history...",
    ),
    "staff.activity.title_login_history": ("История входа", "Kirishlar tarixi", "Login history"),
    # --- Меню → Продажа: остатки --------------------------------------------
    "pages.menupage.open_photo": ("Открыть фото {{name}}", "{{name}} suratini ochish", "Open {{name}} photo"),
    "pages.menupage.no_category": ("Без категории", "Kategoriyasiz", "No category"),
    "pages.menupage.error.invalid_sales": (
        "Некорректный ответ отчёта о продажах.",
        "Savdo hisoboti javobi noto'g'ri.",
        "Invalid sales report response.",
    ),
    "pages.menupage.error.load_sales": (
        "Не удалось загрузить продажи.",
        "Savdoni yuklab bo'lmadi.",
        "Could not load sales.",
    ),
    "pages.menupage.error.load_categories": (
        "Не удалось загрузить категории отчёта.",
        "Hisobot kategoriyalarini yuklab bo'lmadi.",
        "Could not load report categories.",
    ),
    "pages.menupage.error.date_order": (
        "Дата начала периода не может быть позже даты окончания.",
        "Davr boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas.",
        "The period start date cannot be later than the end date.",
    ),
    "pages.menupage.error.no_cogs": (
        "Не сохранена историческая себестоимость блюд.",
        "Taomlarning tarixiy tannarxi saqlanmagan.",
        "Historical dish cost is not stored.",
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
