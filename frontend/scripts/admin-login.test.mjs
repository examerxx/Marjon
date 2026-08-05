import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/admin/AdminApp.jsx", import.meta.url), "utf8");
const adminApiSource = readFileSync(new URL("../src/admin/api.js", import.meta.url), "utf8");
const authSessionSource = readFileSync(new URL("../src/auth/session.js", import.meta.url), "utf8");
const restaurantLogin = readFileSync(new URL("../src/pages/LoginPage.jsx", import.meta.url), "utf8");
const tablesReport = readFileSync(new URL("../src/pages/TablesReportPage.jsx", import.meta.url), "utf8");
const ordersReport = readFileSync(new URL("../src/pages/OrdersReportPage.jsx", import.meta.url), "utf8");
const dishesReport = readFileSync(new URL("../src/pages/DishesReportPage.jsx", import.meta.url), "utf8");
const reportDateRangePicker = readFileSync(new URL("../src/components/ReportDateRangePicker.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/admin/styles.css", import.meta.url), "utf8");
const ruLocale = readFileSync(new URL("../src/i18n/ru.json", import.meta.url), "utf8");

const loginSection = app.slice(app.indexOf("function LoginView"), app.indexOf("function Sidebar"));
const adminSessionResolver = authSessionSource.slice(
  authSessionSource.indexOf("export function resolveAdminAuthSession"),
  authSessionSource.indexOf("export function prepareAuthRequest"),
);

assert.match(loginSection, /const \[phone, setPhone\]/, "Login form must use phone state.");
assert.match(loginSection, /adminLogin\(phone, password\)/, "Login submit must send phone and password.");
assert.match(loginSection, /admin-login__field admin-login__field--phone/, "Phone field must use the compact phone structure.");
assert.match(loginSection, /admin-login__field admin-login__field--password/, "Password field must use the compact password structure.");
assert.match(loginSection, /admin-login__eye/, "Password visibility button must be rendered.");
assert.match(loginSection, /Запомнить меня/, "Remember-me control must be rendered.");
assert.match(loginSection, /Забыли пароль\?/, "Forgot-password action must be rendered.");
assert.doesNotMatch(loginSection, /<input[^>]+type="email"/, "Super admin login must not render the old email input.");
assert.doesNotMatch(loginSection, /placeholder="900000777"/, "Phone input must not show background example text.");
assert.doesNotMatch(loginSection, /placeholder="0000777"/, "Password input must not show background example text.");
assert.doesNotMatch(adminApiSource, /\b(?:LOCAL_)?ADMIN_(?:PHONE|PASSWORD)\b\s*=/i, "Admin API must not contain hardcoded credential constants.");
assert.doesNotMatch(adminApiSource, /isLocalAdmin(?:Host|Credential)/, "Admin API must not contain a local credential bypass.");
assert.doesNotMatch(adminApiSource, /admin_local_login/, "Admin API must not use the legacy local admin flag.");
assert.doesNotMatch(app, /admin_local_login/, "Admin application must not use the legacy local admin flag.");
assert.doesNotMatch(app, /setUser\(\{[\s\S]*?is_superadmin:\s*true\s*\}\)/, "Admin application must not synthesize a superadmin profile.");
assert.match(adminSessionResolver, /getTokenRecord\(AUTH_SCOPES\.ADMIN\)/, "Admin session resolver must read the admin scope.");
assert.doesNotMatch(adminSessionResolver, /AUTH_SCOPES\.DEFAULT/, "Admin session resolver must never fall back to the default scope.");

const submitButtons = loginSection.match(/type="submit"/g) || [];
assert.equal(submitButtons.length, 1, "Login form must render exactly one submit button.");

assert.match(css, /url\("\.\.\/assets\/tashkent-admin-bg\.jpg"\)/, "Admin login must use the local Tashkent background asset.");
assert.doesNotMatch(css, /images\.unsplash\.com\/photo-1695220858703-4ab11b4caed7/, "Admin login must not depend on the old remote Tashkent background.");
// Exact visual properties are covered by tools/css-verify.sh.
assert.match(css, /--admin-shell-bar-bg:\s*[^;]+;/, "Admin shell bar color token must be declared.");
assert.match(css, /\.admin-sidebar\s*{[\s\S]*?background:\s*var\(--admin-shell-bar-bg\)\s*;/, "Admin sidebar must use the shared shell bar token.");
assert.match(css, /\.admin-header\s*{[\s\S]*?background:\s*var\(--admin-shell-bar-bg\)\s*;/, "Admin header must use the shared shell bar token.");
assert.match(app, /const datePresets = useMemo/, "Admin date picker must define quick date presets.");
assert.match(app, /Сегодня[\s\S]*Вчера[\s\S]*Этот месяц[\s\S]*Этот год/, "Admin date picker must include the expected quick presets.");
assert.match(app, /<ReportDateRangePicker[\s\S]*?buttonClassName="admin-finance-date-button"/, "Admin finance header must render the shared report date picker.");
assert.match(reportDateRangePicker, /className="report-period-picker"/, "Shared admin date picker must render the date picker wrapper.");
assert.match(reportDateRangePicker, /className="report-date-menu"/, "Shared admin date picker must render a dropdown menu.");
assert.match(reportDateRangePicker, /aria-label="Предыдущий месяц"/, "Shared admin date picker must support previous-month navigation.");
assert.match(reportDateRangePicker, /aria-label="Следующий месяц"/, "Shared admin date picker must support next-month navigation.");
assert.match(reportDateRangePicker, /aria-label="Начало периода"/, "Shared admin date picker must include a start date input.");
assert.match(reportDateRangePicker, /aria-label="Конец периода"/, "Shared admin date picker must include an end date input.");

const restaurantPasswordInput = restaurantLogin.slice(
  restaurantLogin.indexOf('type={showPassword ? "text" : "password"}'),
  restaurantLogin.indexOf('className="login-pro-eye"')
);

assert.match(restaurantPasswordInput, /placeholder={t\("auth\.password_placeholder"\)}/, "Restaurant login password must use the localized password placeholder.");
assert.doesNotMatch(restaurantPasswordInput, /[•вЂў]{3,}/, "Restaurant login password must not show background dot text.");
assert.match(restaurantLogin, /t\("auth\.welcome_title"\)/, "Restaurant login title must use the localized title key.");
assert.match(restaurantLogin, /t\("auth\.welcome_subtitle"\)/, "Restaurant login subtitle must use the localized subtitle key.");
assert.match(restaurantLogin, /t\("auth\.remember_me"\)/, "Restaurant login remember label must use the localized remember key.");
assert.match(restaurantLogin, /t\("auth\.forgot_password"\)/, "Restaurant login forgot label must use the localized forgot-password key.");
assert.match(ruLocale, /"password_placeholder":\s*"Введите пароль"/, "Russian locale must provide a readable password placeholder.");
assert.match(ruLocale, /"welcome_title":\s*"Добро пожаловать"/, "Russian locale must provide a readable login title.");
assert.match(ruLocale, /"welcome_subtitle":\s*"Войдите в рабочее место вашего ресторана\."/, "Russian locale must provide a readable login subtitle.");
assert.match(ruLocale, /"remember_me":\s*"Запомнить меня"/, "Russian locale must provide a readable remember label.");
assert.match(ruLocale, /"forgot_password":\s*"Забыли пароль\?"/, "Russian locale must provide a readable forgot-password label.");
assert.doesNotMatch(restaurantLogin, /Р[ќџћ”’•—]/, "Restaurant login must not contain mojibake Russian text.");
assert.match(reportDateRangePicker, /className="report-period-picker"/, "Shared report period button must open a date picker wrapper.");
assert.match(reportDateRangePicker, /className="report-date-menu"/, "Shared report date picker must render a dropdown menu.");
assert.doesNotMatch(reportDateRangePicker, /report-period-nav/, "Shared report period button must not show side arrows.");
assert.match(reportDateRangePicker, /Сегодня[\s\S]*Вчера[\s\S]*Этот месяц[\s\S]*Прошлый квартал[\s\S]*Этот год/, "Shared report date picker must include the requested quick presets.");
assert.doesNotMatch(reportDateRangePicker, /Прошлый месяц|Этот квартал|Прошлый год/, "Shared report date picker must not show removed quick presets.");
assert.match(reportDateRangePicker, /type="text"/, "Shared report date picker lower fields must be text inputs so native picker does not overlap presets.");
assert.match(reportDateRangePicker, /inputMode="numeric"/, "Shared report date picker lower fields must stay numeric-friendly.");
assert.match(reportDateRangePicker, /toDateInputText/, "Shared report date picker must format report dates for compact text fields.");
assert.match(reportDateRangePicker, /fromDateInputText/, "Shared report date picker must parse compact text date values.");
assert.match(reportDateRangePicker, /updateDateTime\("start"/, "Shared report date picker must update the lower start datetime field.");
assert.doesNotMatch(reportDateRangePicker, /showPicker/, "Shared report date picker must not open the native picker over the preset menu.");
assert.match(reportDateRangePicker, /report-date-calendar-popover/, "Shared report date picker must render its own calendar outside the preset area.");
assert.match(reportDateRangePicker, /report-date-time-columns/, "Shared report date picker must split time into hour and minute columns.");
assert.match(reportDateRangePicker, /Время/, "Shared report date picker time panel must match the current localized title.");
assert.match(reportDateRangePicker, /selectHour/, "Shared report date picker must allow selecting hours separately.");
assert.match(reportDateRangePicker, /selectMinute/, "Shared report date picker must allow selecting minutes separately.");
assert.match(reportDateRangePicker, /report-date-today-button/, "Shared report date picker must include the reference Today action.");
assert.match(reportDateRangePicker, /report-date-calendar-ok/, "Shared report date picker must include the reference calendar OK action.");
assert.match(reportDateRangePicker, /className="report-date-ok"/, "Shared report date picker must keep OK as a separate action button.");
assert.doesNotMatch(reportDateRangePicker, /function MiniCalendar/, "Shared report date picker must rely on the native datetime calendar, not the old internal calendar.");
assert.doesNotMatch(reportDateRangePicker, /report-mini-calendar/, "Shared report date picker must not render the old internal mini calendar.");
assert.match(reportDateRangePicker, /applyDraft/, "Shared report date picker must apply the selected range.");
assert.match(tablesReport, /<ReportDateRangePicker[\s\S]*?value={dateRange}[\s\S]*?onChange={setDateRange}/, "Tables report must use the shared date picker.");
assert.match(ordersReport, /<ReportDateRangePicker[\s\S]*?value={dateRange}[\s\S]*?onChange={setDateRange}/, "Orders report must use the shared date picker.");
assert.match(dishesReport, /<ReportDateRangePicker[\s\S]*?value={dateRange}[\s\S]*?onChange={setDateRange}/, "Dishes report must use the shared date picker.");

const adminFinanceSection = app.slice(
  app.indexOf("function AdminFinanceOperationsPage"),
  app.indexOf("function AdminFinanceCategoriesPage")
);
const adminFinanceModal = app.slice(
  app.indexOf("function AdminFinanceTransactionModal"),
  app.indexOf("function AdminFinanceOperationsPage")
);
const adminFinanceFilterDrawer = app.slice(
  app.indexOf("function AdminFinanceFilterDrawer"),
  app.indexOf("function AdminFinanceOperationsPage")
);
const adminFinanceDateInput = app.slice(
  app.indexOf("function AdminFinanceDateInput"),
  app.indexOf("function AdminFinanceTransactionModal")
);
const adminFinanceCategoriesPage = app.slice(
  app.indexOf("function AdminFinanceCategoriesPage"),
  app.indexOf("function AdminIncomeCategoriesPage")
);
const adminPaymentMethodsPage = app.slice(
  app.indexOf("function AdminPaymentMethodsPage"),
  app.indexOf("function AdminFinanceHistoryPage")
);
const adminFinanceHistoryPage = app.slice(
  app.indexOf("function AdminFinanceHistoryPage"),
  app.indexOf("function AdminCashierBackgroundPage")
);

assert.match(app, /const adminFinanceApi = {[\s\S]*?createTransaction\(payload, idempotencyKey\)[\s\S]*?adminApi\.post\("\/finance\/transactions", payload/, "Admin finance must create transactions through the existing finance endpoint.");
assert.match(app, /headers:\s*{ "Idempotency-Key": idempotencyKey }/, "Admin finance submit must send an idempotency key to protect repeated requests.");
assert.match(adminFinanceSection, /if \(financeSubmitting\) return;/, "Admin finance submit must block repeated clicks while a request is in flight.");
assert.match(adminFinanceSection, /direction:\s*financeDraft\.operationType/, "Admin finance payload must send backend direction income or expense.");
assert.doesNotMatch(adminFinanceSection, /window\.confirm/, "Admin finance close confirmation must not use the native browser confirm dialog.");
assert.doesNotMatch(app, /adminFinanceDraftNeedsCloseConfirm|admin-finance-close-confirm/, "Admin finance modal must close directly without any dirty-close confirmation panel.");
assert.match(adminFinanceSection, /function requestCloseFinanceModal\(\) \{[\s\S]*?if \(financeSubmitting \|\| financeModalClosing\) return;[\s\S]*?closeFinanceModal\(\);[\s\S]*?\}/, "Admin finance close flow must close the panel directly.");
assert.match(adminFinanceSection, /financeModalClosing[\s\S]*?ADMIN_FINANCE_MODAL_ANIMATION_MS/, "Admin finance modal must keep rendering briefly for the close animation.");
assert.match(adminFinanceModal, /closing \? "is-closing" : "is-opening"/, "Admin finance modal must expose opening and closing animation states.");
assert.match(adminFinanceFilterDrawer, /className="admin-finance-filter-drawer"[\s\S]*?Выберите тип[\s\S]*?Фильтр по контрагентам[\s\S]*?Фильтр по категории[\s\S]*?Фильтровать[\s\S]*?Очистить/, "Admin finance filter button must open the requested filter drawer controls.");
assert.match(adminFinanceSection, /counterpartyFilter[\s\S]*?categoryFilter[\s\S]*?counterpartyMatches[\s\S]*?categoryMatches/, "Admin finance table must filter by counterparty and category.");
assert.match(adminFinanceSection, /<AdminFinanceFilterDrawer[\s\S]*?counterpartyOptions={filterCounterpartyOptions}[\s\S]*?categoryOptions={filterCategoryOptions}/, "Admin finance page must pass table-derived filter options to the drawer.");
assert.match(adminFinanceSection, /onNotify\?\.\(financeDraft\.operationType === "income" \? "Приход успешно добавлен"/, "Admin finance must notify after successful income creation.");
assert.match(adminFinanceSection, /catch \(error\)[\s\S]*?setFinanceSubmitError\(message\)/, "Admin finance must keep form data and show backend errors.");
assert.match(app, /function validateAdminFinanceDraft\(draft\)[\s\S]*?Введите сумму[\s\S]*?Сумма должна быть больше нуля[\s\S]*?Выберите способ оплаты[\s\S]*?Выберите филиал[\s\S]*?Выберите дату[\s\S]*?Выберите категорию/, "Admin finance validation must cover amount, payment, branch, date and category.");
assert.match(adminFinanceModal, /Добавление…/, "Admin finance submit button must show the required loading text.");
assert.match(adminFinanceModal, /maxLength={ADMIN_FINANCE_COMMENT_LIMIT}/, "Admin finance comment field must have a hard character limit.");
assert.match(app, /ADMIN_FINANCE_COUNTERPARTY_TYPES\.map/, "Admin finance modal must render counterparty type selector options.");
assert.doesNotMatch(adminFinanceDateInput, /type="date"/, "Admin finance date field must not use the native browser date picker.");
assert.match(adminFinanceDateInput, /createPortal\([\s\S]*?admin-finance-calendar[\s\S]*?document\.body/, "Admin finance date calendar must render through a portal above scrollable modal content.");
assert.match(adminFinanceDateInput, /admin-finance-calendar__today[\s\S]*?Сегодня[\s\S]*?admin-finance-calendar__ok[\s\S]*?OK/, "Admin finance date field must render the custom admin calendar footer.");
assert.match(adminFinanceCategoriesPage, /admin-income-page admin-finance-category-page/, "Admin finance category pages must have their own template class.");
assert.match(adminFinanceCategoriesPage, /const fallbackCategories = useMemo/, "Admin finance category pages must render their existing local rows when the API is empty or unavailable.");
assert.match(adminFinanceCategoriesPage, /setCategories\(fallbackCategories\)/, "Admin finance category pages must keep the local fallback rows in sync.");
assert.match(adminFinanceCategoriesPage, /admin-income-table-shell[\s\S]*?admin-income-list-head[\s\S]*?admin-income-list/, "Admin finance category page must render a clear table shell with column headings.");
assert.match(adminFinanceCategoriesPage, /editor\.mode === "create" \? "Добавить" : "Сохранить"/, "Admin finance category create modal must use an add action label.");
assert.match(adminPaymentMethodsPage, /const paymentFallbackRows = useMemo\(\(\) => paymentMethodRows\.map/, "Admin payment methods must render existing local rows when the API is empty or unavailable.");
assert.match(adminPaymentMethodsPage, /setMethods\(paymentFallbackRows\)/, "Admin payment methods must keep local fallback rows in sync.");
assert.match(adminPaymentMethodsPage, /sort:\s*Number\(r\.sort_order \?\? r\.sort \?\? index \+ 1\)/, "Admin payment API rows must preserve sort values.");
assert.match(adminFinanceHistoryPage, /const historyFallbackRows = useMemo/, "Admin finance history must render existing local rows when the API is empty or unavailable.");
assert.match(adminFinanceHistoryPage, /setRows\(historyFallbackRows\)/, "Admin finance history must keep local fallback rows in sync.");
assert.match(adminFinanceHistoryPage, /adminApi\.get\("\/finance\/finance-history"/, "Admin finance history must use the existing finance history endpoint.");
assert.match(adminFinanceHistoryPage, /const historyScrollRef = useRef/, "Admin finance history must manage a dedicated visible horizontal scrollbar.");
assert.match(adminFinanceHistoryPage, /className="admin-history-table-wrap"[\s\S]*?ref={historyScrollRef}[\s\S]*?onScroll={updateHistoryScroll}[\s\S]*?onWheelCapture={keepWheelInsideScroller}/, "Admin finance history must keep wheel and scrollbar state synced inside the table scroller.");
assert.match(adminFinanceHistoryPage, /className="admin-history-scrollbar"[\s\S]*?admin-history-scrollbar__button is-prev[\s\S]*?admin-history-scrollbar__track[\s\S]*?admin-history-scrollbar__thumb[\s\S]*?admin-history-scrollbar__button is-next/, "Admin finance history must render the visible reference-style scrollbar under the table.");
assert.match(adminFinanceSection, /<colgroup>[\s\S]*?admin-finance-col-comment[\s\S]*?admin-finance-col-actions[\s\S]*?<\/colgroup>/, "Admin finance table must define stable columns for resize and zoom.");
assert.match(adminFinanceSection, /<td className="admin-finance-comment"><span>{row\.comment}<\/span><\/td>/, "Admin finance comments must render inside a wrapper for multiline clamping.");

console.log("admin login tests passed");
