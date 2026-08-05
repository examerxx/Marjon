// Локализация RU/UZ. Смена языка применяется перезагрузкой окна (см. настройки),
// поэтому t() можно безопасно вызывать и на уровне модуля (значение фиксируется при загрузке).
const DICT = {
  ru: {
    // Общее
    enter: 'Войти', support: 'Служба поддержки', change_org: 'Сменить организацию',
    choose_employee: 'Выберите сотрудника', enter_pin: 'Введите PIN', check: 'Проверка...',
    settings: 'Настройки', switch_mode: 'Сменить режим', logout: 'Выйти',
    online: 'Онлайн', offline: 'Офлайн', queue_hint: 'Записей ждут синхронизации',
    refresh: 'Обновить', lock_screen: 'Заблокировать экран', account: 'Аккаунт', minimize: 'Свернуть окно',
    all: 'Все', locations: 'Локации', overview: 'Обзор', categories: 'Категории',
    stoplist: 'Стоп-лист', finance: 'Финансы', reports: 'Отчёты', history: 'История', queue: 'Очередь',
    mode_cashier: 'Касса', mode_kitchen: 'Кухня', mode_waiter: 'Официант', mode_manager: 'Менеджер',
    pay: 'Оплата', add: 'Добавить', save: 'Сохранить', back: 'Назад', cancel: 'Отмена', edit: 'Изменить',
    free: 'Свободен', busy: 'Занят', ready: 'Готов', await: 'Ожидает оплату', tables: 'Столы', table: 'Стол',
    branch: 'Филиал', staff: 'Сотрудник', loading: 'Загрузка...', no_orders: 'Нет активных заказов',
    search_dish: 'Поиск блюда…', order: 'Заказ', total: 'Итого', comment: 'Комментарий',
    qty: 'Количество', price_per: 'Цена за порцию, сум', currency: 'сум',
    // Типы заказов
    dine_in: 'В зале', takeaway: 'С собой', delivery: 'Доставка', type_qr: 'QR',
    // Статусы заказов
    st_new: 'Новый', st_pending: 'Новый', st_accepted: 'Принят', st_cooking: 'Готовится',
    st_ready: 'Готов', st_completed: 'Закрыт', st_cancelled: 'Отменён',
    // Касса
    to_tables: 'К столам', no_dishes: 'Нет блюд', tap_dish_hint: 'Нажмите на блюдо, чтобы добавить',
    discount: 'Скидка %', discount_word: 'Скидка', to_pay: 'К оплате', order_no: 'Заказ',
    cash: 'Наличные', card: 'Карта', mixed: 'Смешанная',
    items_low: 'позиций', tables_low: 'столов', busy_low: 'занято', in_work: 'в работе', orders_low: 'заказов',
    create_order_error: 'Ошибка создания заказа',
    pay_order: 'Оплата заказа', print_receipt: 'Печать чека', cash_received: 'Получено', change: 'Сдача',
    no_receipt_printer: 'Чековый принтер не настроен (добавьте его в админке по IP)',
    receipt_sent: 'Чек отправлен на печать', complete_order: 'Закрыть заказ', hand_to_cashier: 'Передать на кассу',
    order_items: 'Позиции заказа', to_pay_label: 'К оплате', phone: 'Телефон', address: 'Адрес доставки', move_table: 'Сменить стол',
    cancel_order: 'Отменить заказ', cancel_password_prompt: 'Введите пароль отмены', cancel_error: 'Не удалось отменить заказ',
    no_permission: 'Нет прав на это действие', move_to_table: 'Переместить на стол №', change_waiter: 'Сменить официанта',
    // Техкарта
    tech_card: 'Техкарта', ingredient: 'Ингредиент', amount: 'Кол-во',
    recipe_yield: 'Выход', portion: 'порция', recipe_empty: 'Техкарта для этого блюда ещё не заполнена.',
    // Кухня
    new_orders: 'Новые', cooking_orders: 'Готовятся', ready_orders: 'Готовы',
    sound_on: 'Звук вкл', sound_off: 'Звук выкл', loading_orders: 'Загрузка заказов...',
    new_orders_auto: 'Новые заказы появятся автоматически', done: 'Готово', order_ready_give: 'Заказ готов, отдать',
    // Официант
    all_tables: 'Все столы', hall: 'Зал', new_order: 'Новый заказ',
    no_halls: 'Нет залов. Добавьте их в веб-админке.', add_dishes: 'Добавить блюда',
    close_order: 'Закрыть заказ', no_table: 'Без стола', guests: 'Гостей',
    order_comment: 'Комментарий к заказу...', add_dishes_empty: 'Добавьте блюда',
    sending: 'Отправка...', to_kitchen: 'Отправить на кухню',
    // Менеджер
    today: 'сегодня', orders_today: 'Заказов сегодня', revenue: 'Выручка', avg_check: 'Средний чек',
    recent_orders: 'Последние заказы', no_orders_yet: 'Заказов пока нет.',
    col_no: '№', col_table: 'Стол', col_status: 'Статус', col_time: 'Время', col_sum: 'Сумма', col_type: 'Тип',
    // Блюдо (модалка)
    dish_note_ph: 'Например: без лука, острее, отдельно соус…',
    // Финансы
    fin_title: 'Касса — смена и операции', shift: 'Смена', status: 'Статус',
    fin_status_open: 'Открыта', opened_label: 'Открыта', cash_start_bal: 'Касса на начало',
    cash_end: 'Наличные на конец, сум', close_shift: 'Закрыть смену',
    cash_start_input: 'Наличные на начало смены, сум', open_shift: 'Открыть смену',
    income_expense: 'Приход / расход', amount_sum: 'Сумма, сум', income: 'Приход', expense: 'Расход',
    recent_ops: 'Последние операции', no_ops: 'Операций пока нет.',
    shift_open_err: 'Не удалось открыть смену', shift_close_err: 'Не удалось закрыть смену', op_err: 'Ошибка операции',
    // История
    hist_title: 'История заказов', no_orders_found: 'Заказов не найдено.',
    // Отчёты
    rep_sales: 'Продажи', rep_products: 'Блюда', rep_staff: 'Сотрудники',
    generate: 'Сформировать', generating: 'Формируем отчёт...',
    rep_hint: 'Выберите тип отчёта и период, затем нажмите «Сформировать».',
    rep_unavailable: 'Отчёт недоступен (нет связи или данных).', rep_no_data: 'Нет данных за период.', print: 'Печать',
    col_name: 'Название', col_product: 'Блюдо', col_staff: 'Сотрудник', col_cashier: 'Кассир',
    col_count: 'Кол-во', col_orders: 'Заказы', col_revenue: 'Выручка', col_date: 'Дата',
    col_service: 'Обслуга', col_share: 'Доля официанта', col_price: 'Цена', col_unit: 'Ед.', col_profit: 'Прибыль',
    // Стоп-лист
    only_stop: 'Только в стопе', nothing_found: 'Ничего не найдено.', return_item: 'Вернуть', to_stop: 'В стоп',
    // Настройки
    s_sound: 'Звук', s_sound_notif: 'Звуковые уведомления', s_volume: 'Громкость',
    s_test_sound: 'Проверить звук', s_play: 'Проиграть', s_kitchen_timers: 'Таймеры кухни',
    s_timers_hint: 'Через сколько минут карточка заказа на кухне подсветится жёлтым (внимание) и красным (просрочено).',
    s_yellow_after: 'Жёлтый через, мин', s_red_after: 'Красный через, мин', s_save_thresholds: 'Сохранить пороги',
    s_screen: 'Экран', s_fullscreen: 'Полный экран', s_toggle: 'Переключить', s_zoom: 'Масштаб интерфейса',
    s_autolaunch: 'Запускать при старте Windows', s_lang_theme: 'Язык и тема', s_lang: 'Язык интерфейса',
    s_theme: 'Тема', s_light: 'Светлая', s_dark: 'Тёмная', s_connection: 'Подключение', s_server_addr: 'Адрес сервера',
    s_lan: 'Локальная сеть (для мобильных устройств)',
    s_lan_hint: 'Введите на телефоне сотрудника этот IP и код подключения в настройках — заказы будут идти через этот терминал, даже если у телефона нет интернета.',
    s_lan_addr: 'Адрес', s_lan_token: 'Код подключения', s_lan_clients: 'Подключено устройств',
    printers_diag: 'Принтеры (диагностика)', printers_queue: 'Записей в очереди офлайн', printers_none: 'Принтеры не настроены', printers_ping: 'Пинг',
    ping_ok: 'Доступен с сервера — печать пойдёт напрямую',
    ping_terminal: 'С сервера недоступен, но доступен с этого терминала — печать пойдёт через терминал',
    ping_fail: 'Недоступен ни с сервера, ни с терминала — проверьте IP, порт и сеть',
    // Роли
    role_owner: 'Владелец', role_manager: 'Менеджер', role_cashier: 'Кассир', role_waiter: 'Официант',
    role_cook: 'Повар', role_chef: 'Шеф-повар', role_kitchen: 'Кухня', role_bartender: 'Бармен',
    role_courier: 'Курьер', role_accountant: 'Бухгалтер', role_admin: 'Администратор', role_default: 'Сотрудник',
    // Экраны входа/сервера/режимов/филиалов
    emp_demo_note: 'Показаны демо-сотрудники (нет связи с сервером)', in_session: 'В смене',
    srv_setup: 'Настройка терминала', srv_intro: 'Введите адрес сервера Marjon. Эту настройку выполняет IT-специалист при установке.',
    srv_conn_ok: 'Подключение успешно', srv_test: 'Проверить соединение', srv_save: 'Сохранить и продолжить',
    srv_err_status: 'Сервер ответил', srv_err_conn: 'Не удалось подключиться к серверу',
    md_cashier_desc: 'Приём заказов и оплата', md_kitchen_desc: 'Приготовление заказов', md_waiter_desc: 'Обслуживание столов',
    md_back: 'Назад к филиалам', md_title: 'Рабочее место', md_hint: 'Выберите режим работы',
    lp_phone: 'Номер телефона', lp_password: 'Пароль', lp_phone_incomplete: 'Введите номер телефона полностью',
    lp_bad_creds: 'Неверный телефон или пароль', lp_logging_in: 'Вход...', lp_bind: 'Привязать терминал',
    lp_bad_pin: 'Неверный PIN-код', lp_enter_pin_hint: 'Введите PIN для входа',
    bs_load_err: 'Не удалось загрузить список филиалов', bs_title: 'Выберите филиал', bs_loading: 'Загрузка филиалов...',
    retry: 'Повторить', bs_empty: 'Нет доступных филиалов',
  },
  uz: {
    // Umumiy
    enter: 'Kirish', support: 'Qo‘llab-quvvatlash', change_org: 'Tashkilotni almashtirish',
    choose_employee: 'Xodimni tanlang', enter_pin: 'PIN kiriting', check: 'Tekshirilmoqda...',
    settings: 'Sozlamalar', switch_mode: 'Rejimni almashtirish', logout: 'Chiqish',
    online: 'Onlayn', offline: 'Oflayn', queue_hint: 'Yozuvlar sinxronlashni kutmoqda',
    refresh: 'Yangilash', lock_screen: 'Ekranni bloklash', account: 'Hisob', minimize: 'Oynani yig‘ish',
    all: 'Hammasi', locations: 'Joylar', overview: 'Umumiy', categories: 'Turkumlar',
    stoplist: 'Stop-ro‘yxat', finance: 'Moliya', reports: 'Hisobotlar', history: 'Tarix', queue: 'Navbat',
    mode_cashier: 'Kassa', mode_kitchen: 'Oshxona', mode_waiter: 'Ofitsiant', mode_manager: 'Menejer',
    pay: 'To‘lov', add: 'Qo‘shish', save: 'Saqlash', back: 'Orqaga', cancel: 'Bekor', edit: 'O‘zgartirish',
    free: 'Bo‘sh', busy: 'Band', ready: 'Tayyor', await: 'To‘lovni kutmoqda', tables: 'Stollar', table: 'Stol',
    branch: 'Filial', staff: 'Xodim', loading: 'Yuklanmoqda...', no_orders: 'Faol buyurtmalar yo‘q',
    search_dish: 'Taom qidirish…', order: 'Buyurtma', total: 'Jami', comment: 'Izoh',
    qty: 'Miqdor', price_per: 'Porsiya narxi, so‘m', currency: 'so‘m',
    // Buyurtma turlari
    dine_in: 'Zalda', takeaway: 'O‘zi bilan', delivery: 'Yetkazish', type_qr: 'QR',
    // Buyurtma holatlari
    st_new: 'Yangi', st_pending: 'Yangi', st_accepted: 'Qabul qilindi', st_cooking: 'Tayyorlanmoqda',
    st_ready: 'Tayyor', st_completed: 'Yopilgan', st_cancelled: 'Bekor qilingan',
    // Kassa
    to_tables: 'Stollarga', no_dishes: 'Taom yo‘q', tap_dish_hint: 'Qo‘shish uchun taomni bosing',
    discount: 'Chegirma %', discount_word: 'Chegirma', to_pay: 'To‘lovga', order_no: 'Buyurtma',
    cash: 'Naqd', card: 'Karta', mixed: 'Aralash',
    items_low: 'pozitsiya', tables_low: 'stol', busy_low: 'band', in_work: 'ishda', orders_low: 'buyurtma',
    create_order_error: 'Buyurtma yaratishda xatolik',
    pay_order: 'Buyurtma to‘lovi', print_receipt: 'Chek chop etish', cash_received: 'Berilgan summa', change: 'Qaytim',
    no_receipt_printer: 'Chek printeri sozlanmagan (admin panelda IP bo‘yicha qo‘shing)',
    receipt_sent: 'Chek chop etishga yuborildi', complete_order: 'Buyurtmani yopish', hand_to_cashier: 'Kassaga topshirish',
    order_items: 'Buyurtma tarkibi', to_pay_label: 'To‘lash kerak', phone: 'Telefon', address: 'Yetkazish manzili', move_table: 'Stolni almashtirish',
    cancel_order: 'Buyurtmani bekor qilish', cancel_password_prompt: 'Bekor qilish parolini kiriting', cancel_error: 'Buyurtmani bekor qilib bo‘lmadi',
    no_permission: 'Bu amal uchun ruxsat yo‘q', move_to_table: 'Boshqa stolga №', change_waiter: 'Ofitsiantni almashtirish',
    // Texkarta
    tech_card: 'Texkarta', ingredient: 'Ingredient', amount: 'Miqdor',
    recipe_yield: 'Chiqishi', portion: 'porsiya', recipe_empty: 'Bu taom uchun texkarta hali to‘ldirilmagan.',
    // Oshxona
    new_orders: 'Yangi', cooking_orders: 'Tayyorlanmoqda', ready_orders: 'Tayyor',
    sound_on: 'Ovoz yoq', sound_off: 'Ovoz o‘ch', loading_orders: 'Buyurtmalar yuklanmoqda...',
    new_orders_auto: 'Yangi buyurtmalar avtomatik paydo bo‘ladi', done: 'Tayyor', order_ready_give: 'Buyurtma tayyor, berish',
    // Ofitsiant
    all_tables: 'Barcha stollar', hall: 'Zal', new_order: 'Yangi buyurtma',
    no_halls: 'Zallar yo‘q. Ularni veb-admin panelda qo‘shing.', add_dishes: 'Taom qo‘shish',
    close_order: 'Buyurtmani yopish', no_table: 'Stolsiz', guests: 'Mehmonlar',
    order_comment: 'Buyurtmaga izoh...', add_dishes_empty: 'Taom qo‘shing',
    sending: 'Yuborilmoqda...', to_kitchen: 'Oshxonaga yuborish',
    // Menejer
    today: 'bugun', orders_today: 'Bugungi buyurtmalar', revenue: 'Tushum', avg_check: 'O‘rtacha chek',
    recent_orders: 'So‘nggi buyurtmalar', no_orders_yet: 'Hozircha buyurtma yo‘q.',
    col_no: '№', col_table: 'Stol', col_status: 'Holat', col_time: 'Vaqt', col_sum: 'Summa', col_type: 'Turi',
    // Taom (modal)
    dish_note_ph: 'Masalan: piyozsiz, achchiqroq, sous alohida…',
    // Moliya
    fin_title: 'Kassa — smena va operatsiyalar', shift: 'Smena', status: 'Holat',
    fin_status_open: 'Ochiq', opened_label: 'Ochilgan', cash_start_bal: 'Boshlang‘ich kassa',
    cash_end: 'Yakuniy naqd, so‘m', close_shift: 'Smenani yopish',
    cash_start_input: 'Smena boshidagi naqd, so‘m', open_shift: 'Smenani ochish',
    income_expense: 'Kirim / chiqim', amount_sum: 'Summa, so‘m', income: 'Kirim', expense: 'Chiqim',
    recent_ops: 'So‘nggi operatsiyalar', no_ops: 'Hozircha operatsiya yo‘q.',
    shift_open_err: 'Smenani ochib bo‘lmadi', shift_close_err: 'Smenani yopib bo‘lmadi', op_err: 'Operatsiya xatosi',
    // Tarix
    hist_title: 'Buyurtmalar tarixi', no_orders_found: 'Buyurtma topilmadi.',
    // Hisobotlar
    rep_sales: 'Sotuvlar', rep_products: 'Taomlar', rep_staff: 'Xodimlar',
    generate: 'Shakllantirish', generating: 'Hisobot shakllantirilmoqda...',
    rep_hint: 'Hisobot turi va davrni tanlang, so‘ng «Shakllantirish»ni bosing.',
    rep_unavailable: 'Hisobot mavjud emas (aloqa yoki ma’lumot yo‘q).', rep_no_data: 'Davr uchun ma’lumot yo‘q.', print: 'Chop etish',
    col_name: 'Nomi', col_product: 'Taom', col_staff: 'Xodim', col_cashier: 'Kassir',
    col_count: 'Miqdor', col_orders: 'Buyurtmalar', col_revenue: 'Tushum', col_date: 'Sana',
    col_service: 'Xizmat haqi', col_share: 'Ofitsiant ulushi', col_price: 'Narx', col_unit: 'Birlik', col_profit: 'Foyda',
    // Stop-ro‘yxat
    only_stop: 'Faqat stopda', nothing_found: 'Hech narsa topilmadi.', return_item: 'Qaytarish', to_stop: 'Stopga',
    // Sozlamalar
    s_sound: 'Ovoz', s_sound_notif: 'Ovozli bildirishnomalar', s_volume: 'Balandlik',
    s_test_sound: 'Ovozni tekshirish', s_play: 'Ijro etish', s_kitchen_timers: 'Oshxona taymerlari',
    s_timers_hint: 'Oshxonadagi buyurtma kartasi necha daqiqadan so‘ng sariq (diqqat) va qizil (muddati o‘tgan) rangga o‘tadi.',
    s_yellow_after: 'Sariq necha daqiqada', s_red_after: 'Qizil necha daqiqada', s_save_thresholds: 'Chegaralarni saqlash',
    s_screen: 'Ekran', s_fullscreen: 'To‘liq ekran', s_toggle: 'Almashtirish', s_zoom: 'Interfeys masshtabi',
    s_autolaunch: 'Windows ishga tushganda ochilsin', s_lang_theme: 'Til va mavzu', s_lang: 'Interfeys tili',
    s_theme: 'Mavzu', s_light: 'Yorug‘', s_dark: 'Qorong‘i', s_connection: 'Ulanish', s_server_addr: 'Server manzili',
    s_lan: 'Lokal tarmoq (mobil qurilmalar uchun)',
    s_lan_hint: 'Xodim telefonida sozlamalarga shu IP va ulanish kodini kiriting — internet bo‘lmasa ham buyurtmalar shu terminal orqali ketadi.',
    s_lan_addr: 'Manzil', s_lan_token: 'Ulanish kodi', s_lan_clients: 'Ulangan qurilmalar',
    printers_diag: 'Printerlar (diagnostika)', printers_queue: 'Oflayn navbatdagi yozuvlar', printers_none: 'Printerlar sozlanmagan', printers_ping: 'Ping',
    ping_ok: 'Serverdan mavjud — chop etish to‘g‘ridan-to‘g‘ri ketadi',
    ping_terminal: 'Serverdan mavjud emas, lekin shu terminaldan mavjud — chop etish terminal orqali ketadi',
    ping_fail: 'Na serverdan, na terminaldan mavjud emas — IP, port va tarmoqni tekshiring',
    // Rollar
    role_owner: 'Egasi', role_manager: 'Menejer', role_cashier: 'Kassir', role_waiter: 'Ofitsiant',
    role_cook: 'Oshpaz', role_chef: 'Bosh oshpaz', role_kitchen: 'Oshxona', role_bartender: 'Barmen',
    role_courier: 'Kuryer', role_accountant: 'Buxgalter', role_admin: 'Administrator', role_default: 'Xodim',
    // Kirish/server/rejim/filial ekranlari
    emp_demo_note: 'Demo xodimlar ko‘rsatilmoqda (server bilan aloqa yo‘q)', in_session: 'Smenada',
    srv_setup: 'Terminal sozlamasi', srv_intro: 'Marjon server manzilini kiriting. Buni o‘rnatishda IT-mutaxassis bajaradi.',
    srv_conn_ok: 'Ulanish muvaffaqiyatli', srv_test: 'Ulanishni tekshirish', srv_save: 'Saqlash va davom etish',
    srv_err_status: 'Server javob berdi', srv_err_conn: 'Serverga ulanib bo‘lmadi',
    md_cashier_desc: 'Buyurtma qabul qilish va to‘lov', md_kitchen_desc: 'Buyurtmalarni tayyorlash', md_waiter_desc: 'Stollarga xizmat',
    md_back: 'Filiallarga qaytish', md_title: 'Ish o‘rni', md_hint: 'Ish rejimini tanlang',
    lp_phone: 'Telefon raqami', lp_password: 'Parol', lp_phone_incomplete: 'Telefon raqamini to‘liq kiriting',
    lp_bad_creds: 'Telefon yoki parol noto‘g‘ri', lp_logging_in: 'Kirish...', lp_bind: 'Terminalni bog‘lash',
    lp_bad_pin: 'PIN-kod noto‘g‘ri', lp_enter_pin_hint: 'Kirish uchun PIN kiriting',
    bs_load_err: 'Filiallar ro‘yxatini yuklab bo‘lmadi', bs_title: 'Filialni tanlang', bs_loading: 'Filiallar yuklanmoqda...',
    retry: 'Qayta urinish', bs_empty: 'Mavjud filiallar yo‘q',
  },
}

export function lang() {
  return localStorage.getItem('marjon_lang') === 'uz' ? 'uz' : 'ru'
}
export function t(key) {
  const l = lang()
  return (DICT[l] && DICT[l][key]) || DICT.ru[key] || key
}
// Хелпер для статусов заказа: t.status('cooking') → «Готовится»/«Tayyorlanmoqda»
t.status = (s) => t('st_' + String(s || 'new'))
// Хелпер для типов заказа: t.type('takeaway') → «С собой»/«O‘zi bilan»
t.type = (ty) => (ty === 'qr' ? t('type_qr') : t(String(ty || 'dine_in')))
// Хелпер для ролей: t.role('cashier') → «Кассир»/«Kassir»; неизвестная роль → «Сотрудник»
t.role = (r) => {
  const key = 'role_' + String(r || '').toLowerCase()
  const val = t(key)
  return val === key ? t('role_default') : val
}
