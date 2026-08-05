#!/usr/bin/env bash
# Конвейер аудита CSS: базовый снапшот -> удаление -> снапшот после -> дельта.
set -euo pipefail
cd /agent/workspace/Marjon/frontend
T=/agent/workspace/tools
NODE="node --max-old-space-size=6144"
BUNDLE="${1:-kafe}"
STAGE="${2:-all}"

if [ "$STAGE" = "before" ] || [ "$STAGE" = "all" ]; then
  echo "### 1/4 экспорт правил (до)"
  python3 $T/export_rules.py
  echo "### 2/4 базовый снапшот"
  $NODE tools/cascade.mjs .cssaudit/rules-$BUNDLE.json .cssaudit/dom .cssaudit/before 2>&1 | tail -2
fi

if [ "$STAGE" = "delete" ] || [ "$STAGE" = "all" ]; then
  echo "### 3/4 удаление !important"
  python3 $T/delete_important.py "$BUNDLE" 2>&1 | tail -12
  python3 $T/verify_parser.py 2>&1 | tail -3
fi

if [ "$STAGE" = "after" ] || [ "$STAGE" = "all" ]; then
  echo "### 4/4 снапшот после + дельта"
  python3 $T/export_rules.py
  $NODE tools/cascade.mjs .cssaudit/rules-$BUNDLE.json .cssaudit/dom .cssaudit/after 2>&1 | tail -2
  for W in 390 768 1280; do
    $NODE tools/diff-snap.mjs .cssaudit/before .cssaudit/after $W .cssaudit/delta-$W.json --top=45
  done
fi
echo "### готово"
