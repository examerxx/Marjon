import { useEffect, useMemo, useRef, useState } from "react";
import { staffService } from "../api/staff";
import { settingsService } from "../api/settings";
import { isAbortError, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";
import {
  cashierSwitchFields,
  emptyForm,
  kitchenSwitchFields,
  mapStaffUser,
  monoblockSwitchFields,
  roleMap,
  roleOptions,
  waiterSwitchFields,
  staffPermissionsPayload,
} from "./staff/staffConstants";
import { getPhoneLocal, inferPhoneCountry, normalizePhone } from "./staff/staffPhone";
import StaffToolbar from "./staff/StaffToolbar";
import StaffTable from "./staff/StaffTable";
import StaffFormModal from "./staff/StaffFormModal";
import Toast from "../components/Toast";

// Оркестратор раздела «Сотрудники» OWNER (FE-07B). Владеет сквозным состоянием
// (список, фильтры, форма создания/редактирования) и обработчиками; рендер
// разнесён по презентационным подкомпонентам. Транспорт только через
// staffService (FE-05); безопасность запросов/мутаций сохранена (FE-06).
function StaffRolePage({ role = "all" }) {
  const routeRole = roleMap[role] ? role : "all";
  // CASHIER-FE-01: cashier route is the visual/UX reference; other roles keep legacy UI.
  // WAITER-01: waiter reuses exact cashier presentation (1:1 oracle, 5 switches vs 7).
  const isCashierView = routeRole === "cashier";
  const isWaiterView = routeRole === "waiter";
  // MONOBLOCK-01: monoblock reuses the exact cashier/waiter product drawer
  // shell (1:1 MARJON oracle, 5 primary switches, detailed matrix below).
  const isMonoblockView = routeRole === "monoblock";
  // PIN отдельным полем больше не вводится: у сотрудника PIN = пароль, а у
  // моноблока терминального PIN нет вовсе (вход по телефону и паролю).
  // MANAGER-STOREKEEPER-01: manager + warehouse join the same product Staff
  // family (7 columns, no access column, Cashier-parity drawer matrix, no HR).
  const isManagerView = routeRole === "manager";
  const isWarehouseView = routeRole === "warehouse";
  // KITCHEN-01: повар переехал на тот же продуктовый шаблон, что кассир и
  // официант. Раньше /users/kitchen рендерил легаси-экран с блоком фильтров
  // (.staff-filters), центральным диалогом и заголовком без вкладок статуса —
  // из-за этого раздел выглядел чужим на фоне остальных страниц сотрудников.
  // Кухня — такая же роль зала, как кассир: шапка с вкладками
  // [Активные | Архивированные] + «Добавить», боковой drawer, тот же стол.
  const isKitchenView = routeRole === "kitchen";
  const isProductView = isCashierView || isWaiterView || isMonoblockView || isManagerView || isWarehouseView || isKitchenView;
  // Сеть → филиал: обычный сотрудник (не моноблок) входит в Marjon Staff по
  // своей учётке, а не через филиал-терминал десктопа — приложение резолвит
  // его филиал из User.branch_id (mobile/lib/src/session/session.dart), так
  // что без выбора здесь сотрудник не сможет войти вообще. Моноблок с
  // branch_id не работает (привязан к company целиком), поэтому не входит сюда.
  // Повару филиал нужен так же, как кассиру: кухонный экран ищет PIN только
  // внутри филиала терминала (login_by_pin с branch_id), а KDS-сессия несёт
  // филиал сотрудника. Без User.branch_id повар «сетевой» — виден на кухне
  // любого филиала сети, что для смены поваров неверно.
  const needsBranch = isCashierView || isWaiterView || isManagerView || isWarehouseView || isKitchenView;
  const pageTitle =
    routeRole === "all" ? "Список сотрудников" : `Список сотрудников: ${roleMap[routeRole].title}`;

  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffError, setStaffError] = useState("");
  // Сеть → филиал: список филиалов для селектора привязки моноблока. Грузим
  // только в моноблок-разделе (другим ролям привязка к филиалу не нужна).
  const [branches, setBranches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [pendingActionId, setPendingActionId] = useState("");
  const beginRequest = useLatestRequest();
  const beginBranchesRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();

  useEffect(() => {
    const request = beginRequest();
    setStaffLoading(true);
    setStaffError("");
    staffService.listStaffUsers({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const mapped = (data || []).map(mapStaffUser);
        setStaff(mapped);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        console.warn("Не удалось загрузить сотрудников:", err.message);
        setStaff([]);
        setStaffError("Не удалось загрузить сотрудников.");
      })
      .finally(() => { setStaffLoading(false); });
  }, [beginRequest]);

  // Нужны для селектора привязки к филиалу — отдельный хук, чтобы не
  // отменять загрузку сотрудников.
  useEffect(() => {
    if (!needsBranch) return undefined;
    const request = beginBranchesRequest();
    settingsService.listBranches({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        setBranches(items);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        console.warn("Не удалось загрузить филиалы:", err.message);
        setBranches([]);
      });
    return undefined;
  }, [beginBranchesRequest, needsBranch]);

  // Принтеры компании для селектора «Принтер» в карточке сотрудника.
  // Привязка решает, на какой принтер печатает десктоп, когда за кассой
  // этот сотрудник; пустое значение = чековый принтер филиала.
  // Грузим всегда (не только для ролей с филиалом): таблица показывает
  // привязанный принтер у любой роли, включая моноблок.
  const [printers, setPrinters] = useState([]);
  useEffect(() => {
    let alive = true;
    settingsService.listResource("printers")
      .then(({ data }) => {
        if (!alive) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setPrinters(items.filter((printer) => printer.is_active !== false));
      })
      .catch(() => { if (alive) setPrinters([]); });
    return () => { alive = false; };
  }, []);

  const defaultFilters = useMemo(() => ({
    query: "",
    roleKey: routeRole === "all" ? "" : routeRole,
    status: "",
  }), [routeRole]);

  const [activeTab, setActiveTab] = useState("active");
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filters, setFilters] = useState(defaultFilters);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);
  // Cashier drawer inline submit error (no browser-native popups).
  const [saveError, setSaveError] = useState("");
  // WAITER-01 FIX-02: which field a save error belongs to ("" = drawer-level
  // only). Duplicate-phone 409 binds to "phone" so the message renders
  // directly under the phone input (always near the fold), not only after
  // the long access matrix where users never see it.
  const [saveErrorField, setSaveErrorField] = useState("");
  // ALERT-UNIFY-01: ошибки действий вне модалки (архив/восстановление) тоже
  // показываем тостом — window.alert браузер глушит, и причина остаётся
  // только в консоли.
  const [pageError, setPageError] = useState("");
  const closeTimer = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [phoneCountryOpen, setPhoneCountryOpen] = useState(false);
  const [form, setForm] = useState({
    ...emptyForm,
  });

  useEffect(() => {
    setDraftFilters(defaultFilters);
    setFilters(defaultFilters);
  }, [defaultFilters]);

  const visibleStaff = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLowerCase();

    return staff.filter((employee) => {
      const matchesRoute = routeRole === "all" || employee.roleKey === routeRole;
      const matchesTab = employee.status === activeTab;
      const matchesQuery =
        !normalizedQuery ||
        employee.fullName.toLowerCase().includes(normalizedQuery) ||
        employee.phone.includes(normalizedQuery);
      const matchesRole = !filters.roleKey || employee.roleKey === filters.roleKey;
      const matchesStatus = !filters.status || employee.status === filters.status;

      return matchesRoute && matchesTab && matchesQuery && matchesRole && matchesStatus;
    });
  }, [activeTab, filters, routeRole, staff]);

  useEffect(() => () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const cancelPendingClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setModalClosing(false);
  };

  const openAddModal = () => {
    cancelPendingClose();
    setEditingId(null);
    setShowPassword(false);
    setPhoneCountryOpen(false);
    setForm({
      ...emptyForm,
      phoneCountry: "UZ",
      printerIp: "",
      roleKey: routeRole === "all" ? "cashier" : routeRole,
    });
    setModalOpen(true);
  };

  const openEditModal = (employee) => {
    cancelPendingClose();
    setEditingId(employee.id);
    setShowPassword(false);
    setPhoneCountryOpen(false);
    setForm({ ...emptyForm, ...employee, printerIp: "", phoneCountry: employee.phoneCountry || inferPhoneCountry(employee.phone) });
    setModalOpen(true);
  };

  const closeModal = () => {
    // Cashier/Waiter drawer plays a right-exit animation before unmounting.
    if (isProductView && modalOpen && !modalClosing) {
      setModalClosing(true);
      cancelPendingCloseTimerOnly();
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setModalClosing(false);
        resetModalState();
      }, 260);
      return;
    }
    cancelPendingClose();
    resetModalState();
  };

  const cancelPendingCloseTimerOnly = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const resetModalState = () => {
    setModalOpen(false);
    setEditingId(null);
    setShowPassword(false);
    setPhoneCountryOpen(false);
    setSaveError("");
    setSaveErrorField("");
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleForm = (field) => {
    setForm((current) => ({ ...current, [field]: !current[field] }));
  };

  const selectPhoneCountry = (countryKey) => {
    setForm((current) => ({
      ...current,
      phoneCountry: countryKey,
      phone: current.phone ? normalizePhone(getPhoneLocal(current.phone, current.phoneCountry), countryKey) : "",
    }));
    setPhoneCountryOpen(false);
  };

  const toggleAccess = (moduleKey, actionKey = "enabled") => {
    setForm((current) => {
      const moduleAccess = current.access?.[moduleKey] || {};

      return {
        ...current,
        access: {
          ...(current.access || {}),
          [moduleKey]: {
            ...moduleAccess,
            [actionKey]: !moduleAccess[actionKey],
          },
        },
      };
    });
  };

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setSaveError("Фото: поддерживаются только jpg, png, webp.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setSaveError("Фото больше 5 МБ — выберите файл меньше.");
      return;
    }
    setSaveError("");
    // Сам файл держим в форме и загружаем при сохранении (нужен id
    // сотрудника), а в form.photo кладём data-URL для мгновенного превью.
    setForm((current) => ({ ...current, photoFile: file }));
    const reader = new FileReader();
    reader.onload = () => updateForm("photo", reader.result);
    reader.readAsDataURL(file);
  };

  // Cashier submit errors surface as drawer inline text. Backend detail can
  // be a string, a list of validation dicts, or absent — always reduce to a
  // human-readable string so React never renders [object Object].
  // WAITER-01 LIVE-CREATE-FIX: live backend rejects an already-registered
  // phone with 409 "Phone already registered" (POST) / "Phone already in
  // use" (PATCH). The raw English string made owners retry blindly (9x 409
  // observed live). Map it to a clear Russian message, keeping the original
  // backend text as a suffix so contract tests still match by substring.
  const toDuplicatePhoneError = (detail) => {
    if (detail === "Phone already registered") {
      return "Этот номер уже зарегистрирован. Используйте другой номер телефона (Phone already registered).";
    }
    if (detail === "Phone already in use") {
      return "Этот номер уже используется другим сотрудником (Phone already in use).";
    }
    return null;
  };
  const toCashierSaveError = (err) => {
    const data = err.response?.data;
    if (!data || typeof data !== "object") {
      return typeof err.message === "string" && err.message
        ? err.message
        : "Ошибка сохранения";
    }
    if (typeof data.detail === "string" && data.detail) {
      return toDuplicatePhoneError(data.detail) || data.detail;
    }
    if (Array.isArray(data.detail)) {
      const first = data.detail.find((entry) => entry && typeof entry.msg === "string");
      if (first) return first.msg;
    }
    if (typeof data.message === "string" && data.message) {
      const fields = data.field_errors;
      if (fields && typeof fields === "object") {
        const firstField = Object.values(fields).find(
          (value) => typeof value === "string" && value,
        );
        if (firstField) return `${data.message}: ${firstField}`;
      }
      return data.message;
    }
    return "Ошибка сохранения";
  };

  const saveStaff = async (event) => {
    event.preventDefault();
    if (!mutationLocks.acquire("staff-save")) return;
    const phone = normalizePhone(form.phone, form.phoneCountry);
    // CASHIER/WAITER: product form has no Email input by product contract; the
    // canonical POST /auth/users accepts no address (nullable email).
    // Never fake an email. Edit path unchanged.
    // WAITER-01: same generic staff create, only role_slug differs (cashier/waiter).
    if (isProductView) {
      const productRoleSlug = isWaiterView
        ? "waiter"
        : isMonoblockView
          ? "monoblock"
          : isManagerView
            ? "manager"
            : isWarehouseView
              ? "warehouse"
              : isKitchenView
                ? "kitchen"
                : "cashier";
      const productGenitive = isWaiterView
        ? "официанта"
        : isMonoblockView
          ? "моноблока"
          : isManagerView
            ? "менеджера"
            : isWarehouseView
              ? "завсклада"
              : isKitchenView
                ? "повара"
                : "кассира";
      const productName = form.fullName.trim();
      if (!productName || !phone) {
        // FIX-03: bind to the missing field so the message renders under
        // the relevant input (near the fold), not only below the fold.
        // Copy unchanged.
        setSaveErrorField(!productName ? "name" : "phone");
        setSaveError(`Укажите имя и номер телефона ${productGenitive}.`);
        mutationLocks.release("staff-save");
        return;
      }
      // Поле «Филиал» из карточки убрано (по просьбе владельца). При этом
      // Marjon Staff резолвит филиал сотрудника только из User.branch_id,
      // поэтому: один филиал в сети — подставляем его сами; несколько —
      // не блокируем сохранение (прежняя ошибка «выберите филиал» указывала
      // на поле, которого больше нет). Привязку в мульти-сети решит
      // отдельный сценарий «филиал как аккаунт».
      const soleBranchId = branches.length === 1 ? String(branches[0].id) : "";
      const resolvedBranchId = form.branchId || soleBranchId || null;
      if ((!editingId || form.password) && form.password.length < 4) {
        setSaveErrorField("password");
        setSaveError("Пароль должен содержать минимум 4 символа.");
        mutationLocks.release("staff-save");
        return;
      }
      // PIN для терминала: ровно 4 цифры (пад на кассе принимает только 4).
      // Пустое поле — не трогаем: у сотрудника остаётся прежний код.
      if (form.pin && !/^\d{4}$/.test(form.pin)) {
        setSaveErrorField("pin");
        setSaveError("PIN — ровно 4 цифры.");
        mutationLocks.release("staff-save");
        return;
      }
      // KITCHEN-01: повару PIN обязателен — это единственный способ войти на
      // кухонный экран. Раньше поле можно было оставить пустым, карточка
      // сохранялась, и смена обнаруживала проблему уже у плиты.
      if (isKitchenView && !editingId && !/^\d{4}$/.test(form.pin)) {
        setSaveErrorField("pin");
        setSaveError("PIN — 4 цифры: без него повар не войдёт на кухню.");
        mutationLocks.release("staff-save");
        return;
      }
      setSaveError("");
      setSaveErrorField("");
      setSaving(true);
      try {
        // Тумблеры владельца уходят словарём permissions (legacy-JSON):
        // десктопные гейты can()/must() читают их из /auth/me.
        // Курируемые manager/warehouse primary-тумблеров не имеют
        // (только Статус) — ключ опускаем.
        //
        // Тумблеры прав уходят в permissions и сохраняются в User.permissions
        // (staffPermissionsPayload — тумблеры + матрица). Для PATCH берём вариант
        // с наложением на уже прочитанные permissions: buildStaffPermissions
        // сохраняет ключи, которых нет в форме, а payload собирает только
        // включённое — иначе PATCH затирал бы чужие ключи.
        const rolePermissionFields = isWaiterView
          ? waiterSwitchFields
          : isMonoblockView
            ? monoblockSwitchFields
            : isKitchenView
              ? kitchenSwitchFields
              : isManagerView || isWarehouseView
                ? []
                : cashierSwitchFields;
        // PERMS-ONE-SOURCE-01: один сборщик на POST и PATCH. Ключи —
        // snake_case (staffPermissionKeys) + матрица modules; именно этот
        // формат читают гейты десктопа и API. Раньше create отправлял
        // camelCase, а PATCH — snake_case, поэтому включённые при создании
        // тумблеры выглядели «несохранёнными».
        const permissionsPayload = staffPermissionsPayload(form, rolePermissionFields);
        // Фото больше не «только визуальное»: файл грузится отдельным
        // эндпоинтом после сохранения (нужен id). Email по-прежнему
        // не отправляем — бэкенд хранит NULL (контракт продукта).
        let confirmedUser;
        // Фото грузим ПОСЛЕ сохранения: нужен id сотрудника. Ошибку загрузки
        // не роняем в общий catch — карточка уже сохранена, поэтому пишем
        // сообщение и оставляем прежний аватар.
        const uploadPendingPhoto = async (user) => {
          if (!form.photoFile) return user;
          try {
            const { data } = await staffService.uploadUserPhoto(user.id, form.photoFile);
            return data;
          } catch (err) {
            console.error("Не удалось загрузить фото:", err?.response?.data?.detail || err?.message);
            setSaveError("Сотрудник сохранён, но фото загрузить не удалось. Попробуйте ещё раз.");
            return user;
          }
        };
        if (!editingId) {
          // Моноблок привязан к аккаунту владельца (company), branch_id не
          // шлём. Остальные роли ОБЯЗАНЫ его получить — Marjon Staff резолвит
          // филиал сотрудника только из User.branch_id (без него вход в
          // приложение падает с "Ваш аккаунт не привязан к филиалу").
          const createPayload = {
            password: form.password,
            phone: phone || null,
            role_slug: productRoleSlug,
            role_name: productName,
            // Привязка принтера: null — печать на чековый принтер филиала.
            // manager/warehouse не имеют селектора принтера — ключ не шлём,
            // чтобы не сбросить чужую привязку пустым значением.
            ...(isManagerView || isWarehouseView ? {} : { printer_id: form.printerId || null }),
            // Тумблеры карточки + матрица доступов (User.permissions).
            permissions: permissionsPayload,
            ...(needsBranch ? { branch_id: resolvedBranchId } : {}),
            // PIN для входа на кассе. Моноблоку он не нужен — ключ не шлём.
            ...(!isMonoblockView && form.pin ? { pin: form.pin } : {}),
          };
          const { data: createdUser } = await staffService.createCompanyUser(createPayload);
          confirmedUser = createdUser;
          if (form.status === "archived") {
            const { data } = await staffService.updateCompanyUser(createdUser.id, {
              is_active: false,
            });
            confirmedUser = data;
          }
          // PIN уже уехал в create (см. createPayload выше) — отдельный
          // PATCH здесь больше не нужен и только плодил бы второй 409.
          // Фото грузим от confirmedUser (после возможного deactivate), иначе
          // результат PATCH is_active:false затирался ответом POST (is_active
          // true) и только что созданный архивный сотрудник показывался
          // активным в списке.
          confirmedUser = await uploadPendingPhoto(confirmedUser);
        } else {
          const updatePayload = {
            name: productName,
            password: form.password || undefined,
            phone: phone || null,
            role_slug: productRoleSlug,
            is_active: form.status !== "archived",
            // Явный null — «снять привязку». Бэкенд отличает это от «поле не
            // прислали» через model_fields_set.
            // manager/warehouse не имеют селектора принтера — ключ не шлём,
            // чтобы не сбросить чужую привязку пустым значением.
            ...(isManagerView || isWarehouseView ? {} : { printer_id: form.printerId || null }),
            // На PATCH — тот же словарь, что и на POST: сборщик начинает с
            // уже сохранённых прав (form.permissions) и накладывает тумблеры,
            // поэтому правка имени не затирает чужие ключи.
            permissions: permissionsPayload,
            // Моноблок привязан к аккаунту владельца — филиал не трогаем.
            ...(needsBranch ? { branch_id: resolvedBranchId } : {}),
          };
          const { data: updatedUser } = await staffService.updateCompanyUser(editingId, updatePayload);
          confirmedUser = updatedUser;
          // PIN ставится отдельным эндпоинтом — в PATCH карточки такого поля
          // нет. И строго ПОСЛЕ смены пароля: при пароле из 4–8 цифр бэкенд
          // синхронизирует PIN = пароль и перетёр бы введённый код.
          if (form.pin) {
            await staffService.updateUserPin(confirmedUser.id, form.pin);
          }
          confirmedUser = await uploadPendingPhoto(updatedUser);
        }
        setStaff((current) => {
          const mapped = mapStaffUser(confirmedUser);
          return editingId
            ? current.map((emp) => emp.id === editingId ? mapped : emp)
            : [mapped, ...current.filter((emp) => emp.id !== mapped.id)];
        });
        closeModal();
      } catch (err) {
        console.error("Ошибка сохранения:", err.response?.data?.detail || err.message);
        // WAITER-01 FIX-02: bind duplicate-phone 409 to the phone field so
        // the message is visible without scrolling past the access matrix.
        // Nothing here clears the error afterwards (finally only resets
        // loading) — it stays until retry, close, or a new validation event.
        const detail = err.response?.data?.detail;
        setSaveErrorField(
          detail === "Phone already registered" || detail === "Phone already in use"
            ? "phone"
            : "",
        );
        setSaveError(toCashierSaveError(err));
      } finally {
        setSaving(false);
        mutationLocks.release("staff-save");
      }
      return;
    }
    const email = form.email.trim();
    const roleKey = form.roleKey || "cashier";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roleOptions.some((option) => option.key === roleKey)) {
      // ALERT-UNIFY-01: никаких window.alert — браузер глушит повторные
      // диалоги («предотвратить дополнительные…»), и ошибка остаётся только
      // в консоли. Везде показываем тот же Toast, что и в карточке роли.
      setSaveErrorField("email");
      setSaveError("Укажите email и допустимую роль сотрудника.");
      mutationLocks.release("staff-save");
      return;
    }
    if ((!editingId || form.password) && form.password.length < 4) {
      setSaveErrorField("password");
      setSaveError("Пароль должен содержать минимум 4 символа.");
      mutationLocks.release("staff-save");
      return;
    }
    // PIN отдельным полем: 4 цифры, пусто — прежний код не трогаем.
    if (form.pin && !/^\d{4}$/.test(form.pin)) {
      setSaveErrorField("pin");
      setSaveError("PIN — ровно 4 цифры.");
      mutationLocks.release("staff-save");
      return;
    }
    setSaveError("");
    setSaveErrorField("");
    setSaving(true);

    try {
      if (!editingId) {
        const { data: createdUser } = await staffService.createCompanyUser({
          email,
          password: form.password,
          phone: phone || null,
          role_slug: roleKey,
          ...(form.pin ? { pin: form.pin } : {}),
        });
        setEditingId(createdUser.id);
        setStaff((current) => [mapStaffUser(createdUser), ...current.filter((item) => item.id !== createdUser.id)]);
        let newUser = createdUser;
        if (form.fullName.trim() || form.status === "archived") {
          const { data } = await staffService.updateCompanyUser(createdUser.id, {
            name: form.fullName.trim() || undefined,
            is_active: form.status !== "archived",
          });
          newUser = data;
        }
        setStaff((current) => [mapStaffUser(newUser), ...current.filter((item) => item.id !== newUser.id)]);
      } else {
        const { data: updatedUser } = await staffService.updateCompanyUser(editingId, {
          name: form.fullName,
          email,
          password: form.password || undefined,
          phone: phone || null,
          role_slug: roleKey,
          is_active: form.status !== "archived",
        });
        // PIN — отдельным эндпоинтом и после смены пароля (см. комментарий в
        // продуктовой ветке выше).
        if (form.pin) {
          await staffService.updateUserPin(updatedUser.id, form.pin);
        }
        setStaff((current) => current.map((emp) =>
          emp.id === editingId ? mapStaffUser(updatedUser) : emp
        ));
      }
      closeModal();
    } catch (err) {
      console.error("Ошибка сохранения:", err.response?.data?.detail || err.message);
      setSaveErrorField(
        err.response?.data?.detail === "Phone already registered" ? "phone" : "password",
      );
      setSaveError(toCashierSaveError(err));
    } finally {
      setSaving(false);
      mutationLocks.release("staff-save");
    }
  };

  const archiveStaff = async (id) => {
    const key = `staff-action:${id}`;
    if (!mutationLocks.acquire(key)) return;
    setPendingActionId(String(id));
    try {
      await staffService.deleteCompanyUser(id);
      setStaff((current) => current.map((employee) => (
        employee.id === id ? { ...employee, status: "archived" } : employee
      )));
    } catch (err) {
      console.error("Ошибка архивирования:", err.response?.data?.detail || err.message);
      const detail = err.response?.data?.detail;
      setPageError(
        typeof detail === "string" && detail
          ? toDuplicatePhoneError(detail) || detail
          : "Не удалось архивировать сотрудника.",
      );
    } finally {
      setPendingActionId("");
      mutationLocks.release(key);
    }
  };

  const restoreStaff = async (id) => {
    const key = `staff-action:${id}`;
    if (!mutationLocks.acquire(key)) return;
    setPendingActionId(String(id));
    try {
      await staffService.updateCompanyUser(id, { is_active: true });
      setStaff((current) => current.map((employee) => (
        employee.id === id ? { ...employee, status: "active" } : employee
      )));
    } catch (err) {
      console.error("Ошибка восстановления:", err.response?.data?.detail || err.message);
      const detail = err.response?.data?.detail;
      setPageError(
        typeof detail === "string" && detail
          ? toDuplicatePhoneError(detail) || detail
          : "Не удалось восстановить сотрудника.",
      );
    } finally {
      setPendingActionId("");
      mutationLocks.release(key);
    }
  };

  const applyFilters = () => {
    setFilters(draftFilters);
  };

  const clearFilters = () => {
    const resetFilters = {
      query: "",
      roleKey: routeRole === "all" ? "" : routeRole,
      status: "",
    };
    setDraftFilters(resetFilters);
    setFilters(resetFilters);
  };

  return (
    // WAITER-01: waiter reuses cashier scoped classes for 1:1 visuals (no new CSS).
    <div className={`staff-page${isProductView ? " staff-page--cashier" : ""}`}>
      <section className={`staff-card${isProductView ? " staff-card--cashier" : ""}`}>
        <StaffToolbar
          pageTitle={pageTitle}
          openAddModal={openAddModal}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          draftFilters={draftFilters}
          setDraftFilters={setDraftFilters}
          routeRole={routeRole}
          applyFilters={applyFilters}
          clearFilters={clearFilters}
          hideFilters={isProductView}
        />

        <StaffTable
          staffLoading={staffLoading}
          staffError={staffError}
          visibleStaff={visibleStaff}
          pendingActionId={pendingActionId}
          openEditModal={openEditModal}
          archiveStaff={archiveStaff}
          restoreStaff={restoreStaff}
          isCashier={isCashierView}
          isWaiter={isWaiterView}
          isMonoblock={isMonoblockView}
          isManager={isManagerView}
          isWarehouse={isWarehouseView}
          isKitchen={isKitchenView}
          printers={printers}
        />
      </section>

      {modalOpen && (
        <StaffFormModal
          editingId={editingId}
          saving={saving}
          closeModal={closeModal}
          saveStaff={saveStaff}
          form={form}
          updateForm={updateForm}
          toggleForm={toggleForm}
          selectPhoneCountry={selectPhoneCountry}
          toggleAccess={toggleAccess}
          handlePhotoChange={handlePhotoChange}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          phoneCountryOpen={phoneCountryOpen}
          setPhoneCountryOpen={setPhoneCountryOpen}
          isCashier={isCashierView}
          isWaiter={isWaiterView}
          isMonoblock={isMonoblockView}
          branches={branches}
          printers={printers}
          isManager={isManagerView}
          isWarehouse={isWarehouseView}
          isKitchen={isKitchenView}
          closing={modalClosing}
          saveError={saveError}
          saveErrorField={saveErrorField}
          onClearSaveError={() => { setSaveError(""); setSaveErrorField(""); }}
        />
      )}

      {pageError ? (
        <Toast
          kind="error"
          title="Не удалось выполнить действие"
          message={pageError}
          onClose={() => setPageError("")}
        />
      ) : null}
    </div>
  );
}

export default StaffRolePage;


