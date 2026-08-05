#!/usr/bin/env bash
#
# Проверка, что правки CSS не изменили внешний вид.
#
#   bash tools/css-verify.sh check      сверить с базовым снимком (для CI)
#   bash tools/css-verify.sh baseline   пересчитать снимок (когда изменение намеренное)
#
# Считает эффективный стиль каждого элемента на реальном DOM приложения и
# сравнивает с эталоном. Скриншоты не используются — сравниваются стили,
# поэтому результат стабилен и не зависит от шрифтов и окружения.
#
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-check}"
NODE="node --max-old-space-size=6144"
WIDTHS="390,768,1280,1440"

if [ "$MODE" != "check" ] && [ "$MODE" != "baseline" ]; then
  echo "Использование: bash tools/css-verify.sh [check|baseline]" >&2
  exit 2
fi

echo "▸ 1/3 снимаю DOM приложения"
npx vitest run --config tools/audit/vitest.audit.config.js --silent >/dev/null 2>&1 || {
  echo "  не удалось отрендерить страницы" >&2; exit 1; }
echo "     кафе: $(ls .cssaudit/dom/*.html | wc -l) страниц, админка: $(ls .cssaudit/domadmin/*.html | wc -l)"

echo "▸ 2/3 разбираю CSS"
python3 tools/export_rules.py >/dev/null

echo "▸ 3/3 сверяю стили"
FAIL=0
for BUNDLE in kafe admin; do
  [ "$BUNDLE" = "kafe" ] && DOM=.cssaudit/dom || DOM=.cssaudit/domadmin
  BASE="tools/baseline/$BUNDLE.json"
  echo ""
  echo "── $BUNDLE ──"
  if [ "$MODE" = "baseline" ]; then
    mkdir -p tools/baseline
    $NODE tools/visual-baseline.mjs snapshot ".cssaudit/rules-$BUNDLE.json" "$DOM" "$BASE" "$WIDTHS"
  else
    if [ ! -f "$BASE" ]; then
      echo "  нет базового снимка $BASE — создай через: bash tools/css-verify.sh baseline" >&2
      FAIL=1; continue
    fi
    $NODE tools/visual-baseline.mjs check ".cssaudit/rules-$BUNDLE.json" "$DOM" "$BASE" "$WIDTHS" || FAIL=1
  fi
done

echo ""
if [ "$MODE" = "baseline" ]; then
  echo "Снимок обновлён. Не забудь закоммитить tools/baseline/."
  exit 0
fi

# запрет на возврат !important
python3 tools/no-important.py || FAIL=1

[ "$FAIL" = "0" ] && echo "✓ ВНЕШНИЙ ВИД НЕ ИЗМЕНИЛСЯ, !important отсутствует" || echo "✗ Проверка не пройдена"
exit "$FAIL"
