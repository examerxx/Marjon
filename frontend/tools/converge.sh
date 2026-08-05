#!/usr/bin/env bash
# Итеративно вычищает мёртвый CSS до сходимости.
set -euo pipefail
cd /agent/workspace/Marjon/frontend
T=/agent/workspace/tools
NODE="node --max-old-space-size=6144"
ROUNDS="${1:-3}"

for i in $(seq 1 "$ROUNDS"); do
  echo ""
  echo "════════ ИТЕРАЦИЯ $i ════════"
  $NODE tools/find-dead.mjs .cssaudit/rules-kafe.json .cssaudit/dom .cssaudit/before.1280.jsonl .cssaudit/dead.json 1280 2>&1 | sed -n '2p'
  N=$(python3 -c "import json;print(len(json.load(open('.cssaudit/dead.json'))['dead']))")
  if [ "$N" -eq 0 ]; then echo "мёртвых больше нет — сошлось"; break; fi
  python3 $T/prune_dead.py .cssaudit/dead.json 2>&1 | grep ИТОГО
  DEL=$(python3 $T/prune_dead.py .cssaudit/dead.json --dry 2>&1 | grep ИТОГО | awk '{print $2}')
  python3 $T/export_rules.py > /dev/null 2>&1
  $NODE tools/cascade.mjs .cssaudit/rules-kafe.json .cssaudit/dom .cssaudit/after > /dev/null 2>&1
  $NODE tools/worklist.mjs .cssaudit/before .cssaudit/after 1280 .cssaudit/work-1280.json 2>&1 | sed -n '4,5p'
  if [ "$DEL" = "0" ]; then echo "удалять больше нечего — сошлось"; break; fi
done

python3 $T/verify_parser.py 2>&1 | tail -2
