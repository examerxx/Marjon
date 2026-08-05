#!/usr/bin/env bash
# Восстанавливает исходный CSS из git и считает эталон на широких экранах,
# чтобы поймать регрессии за пределами уже измеренных 390/768/1280.
set -euo pipefail
cd /agent/workspace/Marjon/frontend
BASE=.cssaudit/gitbase
WIDTHS="${1:-1440,1920}"
REF="${2:-e85e978e8a0ea2eac17defcc8fc343469801a48a}"

rm -rf "$BASE"; mkdir -p "$BASE/src/styles" "$BASE/src/admin"
for f in marjon-tokens brand dashboard topbar-widgets forms tables staff-pos responsive \
         app dashboard-curve loader react-overrides receipt auth login-extras; do
  git -C /agent/workspace/Marjon show "$REF:frontend/src/styles/$f.css" > "$BASE/src/styles/$f.css" 2>/dev/null || true
done
git -C /agent/workspace/Marjon show "$REF:frontend/src/admin/styles.css" > "$BASE/src/admin/styles.css" 2>/dev/null || true

python3 - "$BASE" <<'PY'
import sys, os, json
sys.path.insert(0, "/agent/workspace/tools")
import cssx
from export_rules import key_of
root = sys.argv[1]
files = [f for f in cssx.KAFE if f != "src/styles/marjon-restore.css"]
sheets = cssx.load(files, root)
out = []
for sh in sheets:
    for r in sh.rules:
        if r.in_keyframes or not r.decls: continue
        for sel in r.selectors:
            if not sel: continue
            out.append({"sel": sel, "ctx": r.context, "ord": r.order,
                        "spec": cssx.specificity(sel), "key": key_of(sel),
                        "file": r.file, "line": r.line,
                        "d": [[d.prop, d.value, 1 if d.important else 0] for d in r.decls]})
json.dump(out, open(".cssaudit/rules-gitbase.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"эталонных правил: {len(out)}")
PY

node --max-old-space-size=6144 tools/cascade.mjs .cssaudit/rules-gitbase.json .cssaudit/dom .cssaudit/wbefore "$WIDTHS" 2>&1 | tail -1
node --max-old-space-size=6144 tools/cascade.mjs .cssaudit/rules-kafe.json  .cssaudit/dom .cssaudit/wafter  "$WIDTHS" 2>&1 | tail -1
IFS=',' read -ra WS <<< "$WIDTHS"
for W in "${WS[@]}"; do
  node --max-old-space-size=6144 tools/worklist.mjs .cssaudit/wbefore .cssaudit/wafter "$W" ".cssaudit/work-$W.json" 2>&1 | sed -n '2,5p'
done
