// Правила доступа по ролям для фильтрации навигации и страниц.
// Соответствует ТЗ §2.2 (Ролевая фильтрация Sidebar).

export const ROLES = {
  OWNER: "owner",
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  MANAGER: "manager",
  CASHIER: "cashier",
  WAITER: "waiter",
  KITCHEN: "kitchen",
  MONOBLOCK: "monoblock",
};

// Какие верхнеуровневые разделы доступны каждой роли.
// "*" — все разделы.
const ACCOUNT_SECTIONS = ["settings.profile", "settings.support"];
const COMPANY_ADMIN_SECTIONS = [
  "dashboard",
  "reports",
  "users",
  "nomenclature",
  "warehouse",
  "warehouse-report",
  "finance",
  "settings",
  ...ACCOUNT_SECTIONS,
  "orders",
  "reviews",
  "qr",
  "subscription",
];

const ROLE_SECTIONS = {
  owner: "*",
  superadmin: "*",
  admin: COMPANY_ADMIN_SECTIONS,
  manager: COMPANY_ADMIN_SECTIONS,
  cashier: ["dashboard", "orders", ...ACCOUNT_SECTIONS],
  waiter: ["waiter", ...ACCOUNT_SECTIONS],
  kitchen: ["kitchen", ...ACCOUNT_SECTIONS],
  monoblock: ["orders", "waiter"],
};

// Стартовая страница по роли (для редиректа после логина).
export const ROLE_HOME = {
  owner: "/",
  superadmin: "/",
  admin: "/",
  manager: "/",
  cashier: "/orders",
  waiter: "/waiter",
  kitchen: "/kitchen",
  monoblock: "/waiter",
};

const ROUTE_SECTION_RULES = [
  { exact: "/", sectionKey: "dashboard" },
  { prefixes: ["/waiter"], sectionKey: "waiter" },
  { prefixes: ["/kitchen"], sectionKey: "kitchen" },
  { prefixes: ["/finance"], sectionKey: "finance" },
  { prefixes: ["/users", "/staff"], sectionKey: "users" },
  { prefixes: ["/reports", "/analytics"], sectionKey: "reports" },
  { prefixes: ["/stock-report"], sectionKey: "warehouse-report" },
  { prefixes: ["/warehouse"], sectionKey: "warehouse" },
  { prefixes: ["/settings/profile"], sectionKey: "settings.profile" },
  { prefixes: ["/settings/support"], sectionKey: "settings.support" },
  { prefixes: ["/settings"], sectionKey: "settings" },
  {
    prefixes: [
      "/nomenclature/raw-materials",
      "/nomenclature/raw-categories",
      "/nomenclature/semi-finished",
      "/nomenclature/semi-finished-categories",
    ],
    sectionKey: "warehouse",
  },
  { prefixes: ["/nomenclature", "/menu"], sectionKey: "nomenclature" },
  { prefixes: ["/orders", "/store"], sectionKey: "orders" },
  { prefixes: ["/reviews"], sectionKey: "reviews" },
];

function normalizePathname(pathname) {
  const path = String(pathname || "/").split("?")[0].split("#")[0] || "/";
  return path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
}

function startsWithPath(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getRole(user) {
  if (!user) return null;
  if (user.is_superadmin) return ROLES.SUPERADMIN;
  const roles = user.role_slugs || [];
  if (roles.includes(ROLES.OWNER)) return ROLES.OWNER;
  if (roles.includes(ROLES.ADMIN)) return ROLES.ADMIN;
  if (roles.includes(ROLES.MANAGER)) return ROLES.MANAGER;
  if (roles.includes(ROLES.CASHIER)) return ROLES.CASHIER;
  if (roles.includes(ROLES.WAITER)) return ROLES.WAITER;
  if (roles.includes(ROLES.KITCHEN)) return ROLES.KITCHEN;
  if (roles.includes(ROLES.MONOBLOCK)) return ROLES.MONOBLOCK;
  return roles[0] || null;
}

export function canAccessSection(user, sectionKey) {
  const role = getRole(user);
  if (!role) return false;
  const allowed = ROLE_SECTIONS[role];
  if (allowed === "*") return true;
  if (!allowed) return false;
  return allowed.includes(sectionKey);
}

// Route guard helpers.
export function getSectionForPath(pathname) {
  const path = normalizePathname(pathname);
  const rule = ROUTE_SECTION_RULES.find((item) => {
    if (item.exact) return path === item.exact;
    return item.prefixes?.some((prefix) => startsWithPath(path, prefix));
  });
  return rule?.sectionKey || null;
}

export function canAccessPath(user, pathname) {
  const sectionKey = getSectionForPath(pathname);
  return sectionKey ? canAccessSection(user, sectionKey) : false;
}

export function getRoleHomePath(user) {
  const role = getRole(user);
  return ROLE_HOME[role] || "/login";
}

// Применить ролевой фильтр к массиву пунктов меню Sidebar.
export function filterNavItems(navItems, user) {
  const role = getRole(user);
  if (!role) return [];
  if (ROLE_SECTIONS[role] === "*") return navItems;
  return navItems.filter((item) => canAccessSection(user, item.key));
}

// Универсальная проверка действий (PATCH/DELETE).
export function canPerform(user, action) {
  const role = getRole(user);
  if (role === ROLES.OWNER || role === ROLES.SUPERADMIN) return true;
  const actionMap = {
    "employees.write": [ROLES.MANAGER],
    "warehouse.write": [ROLES.MANAGER],
    "orders.write": [ROLES.MANAGER, ROLES.CASHIER, ROLES.WAITER],
    "finance.write": [ROLES.MANAGER],
    "settings.write": [ROLES.MANAGER],
  };
  return (actionMap[action] || []).includes(role);
}
