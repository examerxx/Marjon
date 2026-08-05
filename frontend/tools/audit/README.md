# Инструменты аудита CSS

Сюда вынесено то, что не должно попадать в продуктовый прогон тестов.

## Сбор DOM

Рендерит страницы в jsdom и выгружает разметку — база для расчёта каскада.

```bash
npx vitest run --config tools/audit/vitest.audit.config.js
```

## Конвейер

1. `python3 ../../../tools/export_rules.py` — разбор CSS в JSON
2. `node ../cascade.mjs <rules> <domDir> <prefix> [ширины]` — эффективные стили каждого элемента
3. `node ../worklist.mjs <before> <after> <ширина> <out>` — дедуплицированный список расхождений
4. `node ../find-dead.mjs` — поиск мёртвых деклараций
5. `node ../pass3.mjs` — добор через честную специфичность

Артефакты складываются в `.cssaudit/` (в git не попадают).
