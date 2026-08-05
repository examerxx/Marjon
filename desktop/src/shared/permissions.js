// Права сотрудника приходят из веб-админки (user.permissions).
// Правило: если объект прав не задан (старые/сид-аккаунты) — разрешаем всё.
// Если задан — действие запрещено только когда флаг явно false.
export function can(user, key) {
  const p = user?.permissions
  if (!p || typeof p !== 'object' || Object.keys(p).length === 0) return true
  return p[key] !== false
}
