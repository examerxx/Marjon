# Документация Marjon

Индекс документов репозитория: что читать, что является источником истины, а что
сохранено как история решений.

## Источники истины

| Документ | Статус | О чём |
|----------|--------|-------|
| [ONBOARDING.md](ONBOARDING.md) | актуально | Ввод в проект для нового разработчика: окружение, запуск, карта кода, процессы, деплой |
| [tz/MARJON_TZ_v3.md](tz/MARJON_TZ_v3.md) + [PDF](tz/MARJON_TZ_v3.pdf) | актуально | ТЗ v3.0 (as-built): продукт, роли, архитектура, бизнес-процессы, все экраны, данные, API, ограничения |
| [../DEPLOY.md](../DEPLOY.md) | актуально | Выкат на прод: бэкапы, миграции, статика, магазин десктопа |
| [../CLAUDE.md](../CLAUDE.md) | актуально | Правила работы с репозиторием (в т.ч. для AI-агентов) |
| [STYLEGUIDE.md](STYLEGUIDE.md) | актуально | Дизайн-система, токены, палитра |
| [TESTING_WINDOWS.md](TESTING_WINDOWS.md) | актуально | Запуск и ручное тестирование на Windows (Docker и вручную) |
| [local-object-storage.md](local-object-storage.md) | актуально | Локальное объектное хранилище в dev |
| [../backend/docs/](../backend/docs/) | актуально | Приёмка печати чеков |

## Узкие контракты и ADR

| Документ | О чём |
|----------|-------|
| [web-api-contract-v1.md](web-api-contract-v1.md) | Замороженный контракт Web API (базовая линия ремедиации) |
| [web-rbac-contract-v1.md](web-rbac-contract-v1.md) | Замороженный контракт Web RBAC |
| [adr/](adr/) | Architecture Decision Records по фронтенду и HQ |
| [hq/](hq/) | Архитектурные ограничения HQ-админки |

## История и планы

Эти документы описывают прошлые состояния и решения. Для текущего поведения
используйте код и ТЗ v3.

| Документ | О чём |
|----------|-------|
| [DOCUMENTATION.md](DOCUMENTATION.md) | Ранняя общая техдока проекта |
| [../TASKS.md](../TASKS.md) | Исторический бэклог до production-ready |
| [../OFFLINE_PLAN.md](../OFFLINE_PLAN.md) | План offline-режима десктопа (что реализовано — см. ТЗ v3, §3.5) |
| [DESKTOP_FIXES.md](DESKTOP_FIXES.md), [DESKTOP_SIZE_MIGRATION.md](DESKTOP_SIZE_MIGRATION.md) | История доработок десктопа |
| [CSS_IMPORTANT_PLAN.md](CSS_IMPORTANT_PLAN.md), [SCHEMA_DRIFT.md](SCHEMA_DRIFT.md) | Разборы CSS-монолита и расхождений схемы |
| [BRANCH_ACCOUNT_PLAN.md](BRANCH_ACCOUNT_PLAN.md), [COOK_WEB_PLAN.md](COOK_WEB_PLAN.md) | Планы по аккаунтам филиалов и кухонному вебу |
| [audit.md](audit.md) | Аудит фронтенда |
