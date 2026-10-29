/**
 * Хелпер перевода для кода, где нельзя использовать хук.
 *
 * `useTranslation()` подходит только внутрь компонента. Половина строк проекта
 * лежит в конфигах-массивах, обработчиках и утилитах, которые вызываются из
 * рендера, но сами компонентами не являются. Для них — этот `t`.
 *
 * Перерисовку при смене языка обеспечивает `LanguageBoundary` в `main.jsx`:
 * он меняет `key` у дерева приложения, поэтому весь UI перерисовывается
 * заново и `t()` вызывается уже с новым языком.
 *
 * Резервный поиск по тексту: часть подписей живёт в конфигах на уровне модуля
 * (`{ title: "Приход товаров" }`). Их нельзя перевести на этапе импорта —
 * значение застынет на языке, который был активен при загрузке бандла.
 * Поэтому такие подписи оборачиваются в `t()` уже в рендере, а `t()` умеет
 * принимать не только ключ, но и сам русский текст: если ключа нет, он ищет
 * текст в индексе и переводит найденный ключ.
 */
import i18n from "./index.js";

let textIndex = null;

function buildTextIndex() {
  const index = new Map();
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object") {
        walk(value, path);
      } else if (typeof value === "string" && !index.has(value)) {
        // Первое вхождение выигрывает: одинаковый русский текст в разных
        // namespace переводится одинаково, поэтому выбор безопасен.
        index.set(value, path);
      }
    }
  };
  const bundle = i18n.getResourceBundle("ru", "translation");
  if (bundle) walk(bundle, "");
  return index;
}

export function t(key, options) {
  if (typeof key !== "string") return key;
  if (i18n.exists(key)) return i18n.t(key, options);

  if (!textIndex) textIndex = buildTextIndex();
  const mapped = textIndex.get(key);
  if (mapped) return i18n.t(mapped, options);

  return i18n.t(key, options);
}

export default t;
