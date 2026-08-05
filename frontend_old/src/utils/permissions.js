// Правила доступа по ролям для фильтрации навигации и страниц.
// Соответствует ТЗ §2.2 (Ролевая фильтрация Sidebar).

export const ROLES = {
  OWNER: "owner",
  SUPERADMIN: "superadmin",
  MANAGER: "manager",
  CASHIER: "cashier",
  WAITER: "waiter",
  KITCHEN: "kitchen",
  MONOBLOCK: "monoblock",
};

// Какие верхнеуровневые разделы доступны каждой роли.
// "*" — все разделы.
const ROLE_SECTIONS = {
  owner: "*",
  superadmin: "*",
  manager: ["dashboard", "reports", "users", "nomenclature", "warehouse", "warehouse-report", "finance", "settings", "orders", "qr", "subscription"],
  cashier: ["dashboard", "orders", "settings.profile"],
  waiter: ["waiter"],
  kitchen: ["kitchen"],
  monoblock: ["orders", "waiter"],
};

// Стартовая страница по роли (для редиректа после логина).
export const ROLE_HOME = {
  owner: "/",
  superadmin: "/",
  manager: "/",
  cashier: "/orders",
  waiter: "/waiter",
  kitchen: "/kitchen",
  monoblock: "/waiter",
};

export function getRole(user) {
  if (!user) return null;
  if (user.is_superadmin) return ROLES.SUPERADMIN;
  const roles = user.role_slugs || [];
  if (roles.includes(ROLES.OWNER)) return ROLES.OWNER;
  if (roles.includes(ROLES.MANAGER)) return ROLES.MANAGER;
  if (roles.includes(ROLES.CASHIER)) return ROLES.CASHIER;
  if (roles.includes(ROLES.WAITER)) return ROLES.WAITER;
  if (roles.includes(ROLES.KITCHEN)) return ROLES.KITCHEN;
  if (roles.includes(ROLES.MONOBLOCK)) return ROLES.MONOBLOCK;
  return roles[0] || ROLES.OWNER;
}

export function canAccessSection(user, sectionKey) {
  const role = getRole(user);
  if (!role) return false;
  const allowed = ROLE_SECTIONS[role];
  if (allowed === "*") return true;
  if (!allowed) return false;
  return allowed.includes(sectionKey);
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
