"""Жёсткие инварианты цепочки миграций — статический анализ, без БД.

Зачем этот файл
---------------
`test_migrations.py` проверяет, что цепочка *связна* и что на реальном Postgres
она проходится. Этого не хватило: после мерджа main ← prod-current в цепочке
оказались две ревизии, создающие одну и ту же пару колонок
(`branches.login` / `branches.password_hash`). Граф был идеально связным,
`alembic heads` показывал один head, а `alembic upgrade head` на чистой базе
падал:

    asyncpg.exceptions.DuplicateColumnError: column "login" of relation
    "branches" already exists

Причина — не битый граф, а **дубликат DDL между предком и потомком**: миграция
`d7e8brnlog11` (prod-линия) уже создала колонки, а `br01login` (наша линия)
создавала их ещё раз, потому что до мерджа они жили в разных линиях и друг о
друге не знали.

Проверки ниже ловят именно этот класс ошибок до запуска на Postgres:

* дубликат add-операции между предком и потомком — разрешён ТОЛЬКО под
  проверкой существования (`sa.inspect(...)` + `if ... not in ...`), иначе
  миграция не идемпотентна и упадёт на базе, где предок уже применён;
* дубликат add-операции между ПАРАЛЛЕЛЬНЫМИ линиями — запрещён всегда: после
  мерджа обе линии применяются к одной базе, порядок между ними не определён;
* merge-ревизии обязаны быть пустыми (никакого DDL внутри мерджа);
* id ревизии обязан влезать в `alembic_version.version_num` (VARCHAR(32));
* новые файлы миграций обязаны содержать id ревизии в имени файла.

Все проверки — чтение AST, ни одного подключения к БД, поэтому файл работает
в обычном backend-джобе CI за миллисекунды.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path
import re

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
VERSIONS_DIR = BACKEND_ROOT / "migrations" / "versions"

# Опорная точка цепочки: ревизия, на которой граф был признан линейным
# (мердж main ← prod-current). Новые миграции наращивают head — это норма,
# поэтому сам head не захардкожен. А вот опорная ревизия обязана оставаться
# предком головы: если она «отвалилась», цепочку переписали и базы, стоящие
# на ней, до head уже не доедут.
ANCHOR_REVISION = "mg02merge"

# alembic_version.version_num — VARCHAR(32) в дефолтном шаблоне alembic.
MAX_REVISION_ID_LENGTH = 32

# Функции рефлексии, по которым определяется «проверка существования».
_EXISTENCE_FUNCS = frozenset({
    "get_columns",
    "get_indexes",
    "get_table_names",
    "get_unique_constraints",
    "get_foreign_keys",
    "get_check_constraints",
    "has_table",
})

# Легаси-файлы, чьё имя не содержит id ревизии (появились до договорённости).
# Список заморожен: новые миграции в него добавлять нельзя, только исправлять
# имя файла. Проверка ниже держит список ровно таким — если файл переименуют,
# тест потребует убрать запись.
_LEGACY_FILENAMES_WITHOUT_REVISION = frozenset({
    "20260611_warehouse_documents.py",
    "20260809_bi05a_finance_ownership.py",
    "20260809_bi05b_financial_operation_idempotency.py",
    "20260809_bi05c1_local_fiscal_integrity.py",
    "20260809_bi05e1_decimal_fingerprint.py",
    "20261017_att01attendance_status.py",
    "20261108_support_session_shifts.py",  # Already deployed historical server revision.
})

# Виды add-операций и ключ, которым они идентифицируются.
# column  -> (table, column)
# index   -> (index_name, table)
# table   -> (table,)
_ADD_OPS = frozenset({"add_column", "create_index", "create_table"})
_DROP_OPS = frozenset({"drop_column", "drop_index", "drop_table"})


@dataclass(frozen=True)
class _Add:
    kind: str
    target: tuple[str, ...]
    guarded: bool
    lineno: int


@dataclass(frozen=True)
class _Drop:
    kind: str
    target: tuple[str, ...]
    lineno: int


@dataclass(frozen=True)
class _Migration:
    revision: str
    down_revision: str | tuple[str, ...] | None
    path: Path
    adds: tuple[_Add, ...]
    drops: tuple[_Drop, ...]

    @property
    def parents(self) -> tuple[str, ...]:
        if isinstance(self.down_revision, tuple):
            return self.down_revision
        return () if self.down_revision is None else (self.down_revision,)

    @property
    def is_merge(self) -> bool:
        return isinstance(self.down_revision, tuple)


# ── Разбор AST ───────────────────────────────────────────────────────────────


def _module_string_constants(tree: ast.Module) -> dict[str, str]:
    """Верхнеуровневые `_TABLE = "halls"`-константы: аргументы op.* часто через них."""
    constants: dict[str, str] = {}
    for node in tree.body:
        target = node.target if isinstance(node, ast.AnnAssign) else (
            node.targets[0] if isinstance(node, ast.Assign) and node.targets else None
        )
        if not isinstance(target, ast.Name):
            continue
        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            constants[target.id] = node.value.value
    return constants


def _resolve_str(node: ast.AST, constants: dict[str, str]) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return constants.get(node.id)
    return None


def _called_names(node: ast.AST) -> set[str]:
    """Имена вызываемых функций/методов в поддереве (`get_columns`, `_existing_columns`)."""
    names: set[str] = set()
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        func = child.func
        if isinstance(func, ast.Attribute):
            names.add(func.attr)
        elif isinstance(func, ast.Name):
            names.add(func.id)
    return names


def _reflection_helpers(tree: ast.Module) -> set[str]:
    """Функции модуля, которые читают схему (`_existing_columns`, `_index_names`).

    Нужны, потому что гейт часто спрятан в хелпер: `existing = _existing_columns()`
    и только внутри — `sa.inspect(bind).get_columns(...)`. Транзитивность
    (хелпер, вызывающий хелпер) разрешаем до неподвижной точки.
    """
    bodies: dict[str, ast.AST] = {
        node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)
    }
    helpers: set[str] = set()
    changed = True
    while changed:
        changed = False
        for name, node in bodies.items():
            if name in helpers:
                continue
            calls = _called_names(node)
            if calls & _EXISTENCE_FUNCS or "inspect" in calls or calls & helpers:
                helpers.add(name)
                changed = True
    return helpers


def _existence_guard_names(tree: ast.Module, helpers: set[str]) -> set[str]:
    """Имена, связанные с результатом рефлексии (`columns`, `existing_tables`, ...).

    Смотрим на всё поддерево правой части, а не только на прямой вызов:
    `columns = {c["name"] for c in inspector.get_columns("branches")}` —
    это SetComp, внутри которого и живёт вызов.
    """
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        calls = _called_names(node.value)
        if not (calls & _EXISTENCE_FUNCS or calls & helpers or "inspect" in calls):
            continue
        targets = [node.target] if isinstance(node, ast.AnnAssign) else node.targets
        for target in targets:
            if isinstance(target, ast.Name):
                names.add(target.id)
    return names


def _is_existence_test(test: ast.AST, guard_names: set[str], helpers: set[str]) -> bool:
    """Условие читает состояние схемы: рефлексия напрямую, через хелпер или имя."""
    calls = _called_names(test)
    if calls & _EXISTENCE_FUNCS or calls & helpers or "inspect" in calls:
        return True
    text = ast.unparse(test)
    return any(re.search(rf"\b{re.escape(name)}\b", text) for name in guard_names)


def _target_of(call: ast.Call, op: str, constants: dict[str, str]) -> tuple[str, ...] | None:
    args = call.args
    if op == "add_column" and len(args) >= 2:
        table = _resolve_str(args[0], constants)
        column: str | None = None
        if isinstance(args[1], ast.Call) and args[1].args:
            column = _resolve_str(args[1].args[0], constants)
        return (table, column) if table and column else None
    if op == "create_index" and len(args) >= 2:
        name = _resolve_str(args[0], constants)
        table = _resolve_str(args[1], constants)
        return (name, table) if name and table else None
    if op == "create_table" and args:
        table = _resolve_str(args[0], constants)
        return (table,) if table else None
    if op == "drop_column" and len(args) >= 2:
        table = _resolve_str(args[0], constants)
        column = _resolve_str(args[1], constants)
        return (table, column) if table and column else None
    if op == "drop_index" and args:
        name = _resolve_str(args[0], constants)
        table = None
        for keyword in call.keywords:
            if keyword.arg == "table_name":
                table = _resolve_str(keyword.value, constants)
        # table_name может отсутствовать — тогда ключ только по имени индекса.
        return (name, table or "") if name else None
    if op == "drop_table" and args:
        table = _resolve_str(args[0], constants)
        return (table,) if table else None
    return None


def _collect_op_calls(
    node: ast.AST,
    constants: dict[str, str],
    guard_names: set[str],
    helpers: set[str],
    adds: list[_Add],
    drops: list[_Drop],
    *,
    guarded: bool = False,
) -> None:
    if isinstance(node, ast.If):
        inner = guarded or _is_existence_test(node.test, guard_names, helpers)
        _collect_op_calls(node.test, constants, guard_names, helpers, adds, drops, guarded=guarded)
        for child in node.body:
            _collect_op_calls(child, constants, guard_names, helpers, adds, drops, guarded=inner)
        for child in node.orelse:
            _collect_op_calls(child, constants, guard_names, helpers, adds, drops, guarded=guarded)
        return

    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ):
        op = node.func.attr
        if op in _ADD_OPS:
            target = _target_of(node, op, constants)
            if target is not None:
                adds.append(_Add(op, target, guarded, node.lineno))
        elif op in _DROP_OPS:
            target = _target_of(node, op, constants)
            if target is not None:
                drops.append(_Drop(op, target, node.lineno))

    for child in ast.iter_child_nodes(node):
        _collect_op_calls(child, constants, guard_names, helpers, adds, drops, guarded=guarded)


def _parse(path: Path) -> _Migration:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    revision: str | None = None
    down_revision: str | tuple[str, ...] | None = None
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        target = node.target if isinstance(node, ast.AnnAssign) else (
            node.targets[0] if node.targets else None
        )
        if not isinstance(target, ast.Name):
            continue
        if target.id == "revision":
            revision = ast.literal_eval(node.value)
        elif target.id == "down_revision":
            down_revision = ast.literal_eval(node.value)

    assert revision, f"{path.name}: не найден `revision`"
    constants = _module_string_constants(tree)
    helpers = _reflection_helpers(tree)
    guard_names = _existence_guard_names(tree, helpers)
    adds: list[_Add] = []
    drops: list[_Drop] = []
    _collect_op_calls(tree, constants, guard_names, helpers, adds, drops)
    return _Migration(revision, down_revision, path, tuple(adds), tuple(drops))


def _load_chain() -> dict[str, _Migration]:
    chain: dict[str, _Migration] = {}
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name == "__init__.py":
            continue
        migration = _parse(path)
        assert migration.revision not in chain, (
            f"дубликат id ревизии {migration.revision!r}: "
            f"{chain[migration.revision].path.name} и {path.name}"
        )
        chain[migration.revision] = migration
    assert chain, f"в {VERSIONS_DIR} не найдено ни одной миграции"
    return chain


def _ancestors(chain: dict[str, _Migration], revision: str) -> set[str]:
    seen: set[str] = set()
    stack = list(chain[revision].parents)
    while stack:
        cursor = stack.pop()
        if cursor in seen:
            continue
        assert cursor in chain, (
            f"{chain[revision].path.name}: down_revision {cursor!r} не найден среди ревизий"
        )
        seen.add(cursor)
        stack.extend(chain[cursor].parents)
    return seen


@pytest.fixture(scope="module")
def chain() -> dict[str, _Migration]:
    return _load_chain()


# ── Форма графа ──────────────────────────────────────────────────────────────


def test_chain_has_single_expected_head_and_every_revision_is_reachable(
    chain: dict[str, _Migration],
) -> None:
    referenced = {parent for migration in chain.values() for parent in migration.parents}
    heads = set(chain) - referenced
    assert len(heads) == 1, (
        f"ожидался ровно один head, получено {sorted(heads)}. "
        "Незамёрдженная ветка = `alembic upgrade head` упадёт с "
        "«Multiple head revisions are present»."
    )
    head = heads.pop()
    reachable = _ancestors(chain, head) | {head}
    orphans = set(chain) - reachable
    assert not orphans, (
        f"ревизии недостижимы из head {head!r}: {sorted(orphans)} — "
        "их DDL никогда не применится ни на одной базе"
    )
    # Новые миграции наращивают head — это нормально. Ненормально, если из
    # новой головы перестала достигаться опорная точка: значит граф переписали
    # и базы, стоящие на ней, до head не доедут.
    assert ANCHOR_REVISION in reachable, (
        f"опорная ревизия {ANCHOR_REVISION!r} больше не предок head {head!r} — "
        "цепочку переписали, старые базы не смогут обновиться"
    )


def test_root_revision_has_no_parent_and_all_others_have_one(chain: dict[str, _Migration]) -> None:
    roots = sorted(rev for rev, migration in chain.items() if migration.down_revision is None)
    assert roots == ["3dd82166af1e"], (
        f"ожидался ровно один корень '3dd82166af1e', получено {roots}"
    )
    for revision, migration in chain.items():
        if migration.is_merge:
            assert len(migration.parents) >= 2, (
                f"{migration.path.name}: tuple down_revision обязан содержать >=2 родителей"
            )
        else:
            assert len(migration.parents) <= 1, (
                f"{migration.path.name}: у обычной ревизии не больше одного родителя"
            )


def test_revision_ids_fit_alembic_version_column(chain: dict[str, _Migration]) -> None:
    too_long = {rev: len(rev) for rev in chain if len(rev) > MAX_REVISION_ID_LENGTH}
    assert not too_long, (
        f"id ревизии длиннее VARCHAR({MAX_REVISION_ID_LENGTH}) из alembic_version: {too_long}"
    )


def test_every_revision_file_declares_upgrade_and_downgrade(chain: dict[str, _Migration]) -> None:
    for revision, migration in chain.items():
        tree = ast.parse(migration.path.read_text(encoding="utf-8"))
        functions = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
        missing = {"upgrade", "downgrade"} - functions
        assert not missing, f"{migration.path.name}: отсутствуют функции {sorted(missing)}"


def test_new_migration_filenames_contain_their_revision_id(chain: dict[str, _Migration]) -> None:
    """Имя файла обязано содержать id ревизии — иначе grep по логу бесполезен."""
    violations = []
    for revision, migration in chain.items():
        name = migration.path.name
        if name in _LEGACY_FILENAMES_WITHOUT_REVISION:
            continue
        if f"_{revision}_" not in f"{migration.path.stem}_":
            violations.append(name)
    assert not violations, (
        "имя файла миграции не содержит id ревизии отдельным токеном "
        f"(YYYYMMDD_<revision>_<slug>.py): {sorted(violations)}"
    )

    # Список легаси-исключений не должен разрастаться и не должен протухать.
    actual_legacy = {
        migration.path.name
        for revision, migration in chain.items()
        if revision not in migration.path.stem.split("_")
    }
    assert actual_legacy == set(_LEGACY_FILENAMES_WITHOUT_REVISION), (
        "список легаси-имён разошёлся с фактом: "
        f"факт={sorted(actual_legacy)}, "
        f"в тесте={sorted(_LEGACY_FILENAMES_WITHOUT_REVISION)}. "
        "Новую миграцию добавлять в список нельзя — исправьте имя файла."
    )


def test_merge_revisions_are_schema_noop(chain: dict[str, _Migration]) -> None:
    """Мердж сводит линии, но не меняет схему: DDL внутри мерджа не виден ревью."""
    merges = [migration for migration in chain.values() if migration.is_merge]
    assert {migration.revision for migration in merges} == {"mg01merge", "mg02merge", "mg03merge"}
    for migration in merges:
        assert not migration.adds, (
            f"{migration.path.name}: merge-ревизия не должна создавать объекты "
            f"({[(a.kind, a.target) for a in migration.adds]})"
        )
        assert not migration.drops, (
            f"{migration.path.name}: merge-ревизия не должна удалять объекты "
            f"({[(d.kind, d.target) for d in migration.drops]})"
        )


# ── Дубликаты DDL ────────────────────────────────────────────────────────────


def _fmt(kind: str, target: tuple[str, ...]) -> str:
    return f"{kind}{target}"


def test_repeated_add_along_the_chain_must_be_guarded(chain: dict[str, _Migration]) -> None:
    """add, который уже сделал предок, допустим только под проверкой существования.

    Ровно этот случай уронил CI: `br01login` создавал `branches.login`, хотя
    предок `d7e8brnlog11` создал их раньше. Без `sa.inspect(...)`-гейта
    `alembic upgrade head` на чистой базе падает DuplicateColumnError.
    """
    violations: list[str] = []
    for revision, migration in chain.items():
        ancestors = _ancestors(chain, revision)
        ancestor_adds: dict[tuple[str, tuple[str, ...]], list[str]] = {}
        ancestor_drops: set[tuple[str, tuple[str, ...]]] = set()
        for ancestor in ancestors:
            for add in chain[ancestor].adds:
                ancestor_adds.setdefault((add.kind, add.target), []).append(ancestor)
            for drop in chain[ancestor].drops:
                ancestor_drops.add((drop.kind, drop.target))
        for add in migration.adds:
            key = (add.kind, add.target)
            if key not in ancestor_adds or key in ancestor_drops:
                continue
            if add.guarded:
                continue
            violations.append(
                f"{migration.path.name}:{add.lineno} {_fmt(add.kind, add.target)} — "
                f"уже создаётся предком {sorted(set(ancestor_adds[key]))} без "
                "проверки существования"
            )
    assert not violations, (
        "неидемпотентные повторные add-операции вдоль цепочки "
        "(упадут DuplicateColumnError/DuplicateTableError на базе, где предок "
        "уже применён):\n  " + "\n  ".join(violations) + "\n"
        "Починка: обернуть в `inspector = sa.inspect(op.get_bind())` + "
        "`if ... not in ...` (образец — 20261017_br01login_branch_login_columns.py)."
    )


def test_parallel_branches_must_not_add_the_same_object(chain: dict[str, _Migration]) -> None:
    """Две линии, добавляющие один объект, после мерджа применяются к одной базе.

    Пока линии жили раздельно, дубликат не проявлялся; после мерджа обе
    ревизии попадают в одну цепочку, порядок между ними не определён — это
    гарантированный конфликт на чистой базе.
    """
    revisions = sorted(chain)
    violations: list[str] = []
    for index, left in enumerate(revisions):
        for right in revisions[index + 1:]:
            left_ancestors = _ancestors(chain, left)
            right_ancestors = _ancestors(chain, right)
            if left in right_ancestors or right in left_ancestors:
                continue  # одна линия — этот случай проверяет тест выше
            left_adds = {(add.kind, add.target) for add in chain[left].adds}
            right_adds = {(add.kind, add.target) for add in chain[right].adds}
            for kind, target in left_adds & right_adds:
                violations.append(
                    f"{chain[left].path.name} и {chain[right].path.name} обе создают "
                    f"{_fmt(kind, target)}"
                )
    assert not violations, (
        "параллельные линии создают один и тот же объект — после мерджа это "
        "конфликт на чистой базе:\n  " + "\n  ".join(violations) + "\n"
        "Починка: оставить создание в одной линии, во второй — только "
        "идемпотентный гейт (sa.inspect) либо no-op."
    )


def test_guarded_duplicates_are_actually_idempotent_by_construction(
    chain: dict[str, _Migration],
) -> None:
    """Гейт должен опираться на рефлексию, а не на `try/except` вокруг DDL.

    Проверяем обратное утверждение: каждый add, помеченный guarded, лежит
    внутри `if`, чьё условие реально читает состояние схемы. Иначе «guarded»
    превратится в ярлык, который ничего не гарантирует.
    """
    guarded_adds = [add for migration in chain.values() for add in migration.adds if add.guarded]
    assert guarded_adds, (
        "ни одной guarded add-операции не найдено — значит детектор гейтов сломан "
        "(ожидались минимум br01login/att01status/w8x9hall1)"
    )
    # Структурная гарантия: guard-имена находятся только в функциях, где есть
    # вызов рефлексии; это проверяет сам _collect_op_calls. Здесь фиксируем
    # состав guarded-операций, чтобы регрессия гейта была видна как diff.
    guarded_targets = {(add.kind, add.target) for add in guarded_adds}
    assert ("add_column", ("branches", "login")) in guarded_targets
    assert ("add_column", ("attendance_logs", "status")) in guarded_targets
    assert ("create_table", ("halls",)) in guarded_targets
