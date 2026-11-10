// Права сотрудника приходят из веб-админки (user.permissions).
// Правило: если объект прав не задан (старые/сид-аккаунты) — разрешаем всё.
// Если задан — действие запрещено только когда флаг явно false.
//
// ВАЖНО: веб-админка пишет флаги в camelCase (`canDeleteDishes`), а десктоп
// исторически проверяет snake_case (`can_delete_dishes`). Чтобы тумблеры из
// админки реально работали в терминале, читаем ключ в обоих написаниях.

function toCamel(key) {
  return String(key).replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase())
}

function toSnake(key) {
  return String(key).replace(/([A-Z])/g, (ch) => '_' + ch.toLowerCase())
}

// Значение флага по любому из написаний. undefined = ключа нет вовсе.
function readFlag(permissions, key) {
  if (!permissions || typeof permissions !== 'object') return undefined
  if (key in permissions) return permissions[key]
  const camel = toCamel(key)
  if (camel in permissions) return permissions[camel]
  const snake = toSnake(key)
  if (snake in permissions) return permissions[snake]
  return undefined
}

export function can(user, key) {
  const p = user?.permissions
  if (!p || typeof p !== 'object' || Object.keys(p).length === 0) return true
  return readFlag(p, key) !== false
}

// Строгая проверка для ОПАСНЫХ действий (удаление/перенос блюда, смена стола,
// отмена заказа): разрешаем ТОЛЬКО когда право явно выдано в админке (=== true).
// В отличие от can(), пустой/незаданный объект прав здесь НЕ разрешает.
export function must(user, key) {
  return readFlag(user?.permissions, key) === true
}

// Владелец на терминале входит без словаря permissions (как в веб-админке),
// поэтому панели, которые владелец всегда видит в вебе, открываем и здесь.
export function isOwner(user) {
  const slugs = user?.role_slugs || (user?.role_slug ? [user.role_slug] : [])
  return slugs.includes('owner')
}

// Строгая проверка с владельцем: тумблер выдан ИЛИ это владелец компании.
export function mustOrOwner(user, key) {
  return isOwner(user) || must(user, key)
}
