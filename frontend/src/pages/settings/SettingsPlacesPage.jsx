import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { normalizeApiError } from "../../api/errors";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";

// "Доп. цена" = additional-price model. Canonical Hall.pricing_type values
// (Marjon-backend-integration halls/schemas.py: percent|hourly|fixed|time_based).
// Only the two additional-price kinds are offered here; the service % is its
// own field, so pricing_type=percent is not surfaced as an "additional price".
// `time_based` exists in the backend enum but has no product semantics yet, so
// it is deliberately not offered.
// Phase 5C-5.1: the "Выберите..." hint is NOT a member of this list — it is the
// control's placeholder, so it can never be picked from the open panel.
const ADDITIONAL_PRICE_TYPES = [
  { value: "fixed", label: "Дополнительная цена" },
  { value: "hourly", label: "Цена за час" },
];
const PRICING_PLACEHOLDER = "Выберите...";

// Backend 409 details. Only the duplicate-number contract (Phase 5C-3) is
// recognised, so the conflict can be tied to the number field; every other
// conflict ("Место неактивно…", "Филиал неактивен", "Укажите филиал") is shown
// with its own canonical wording and never relabelled.
const DUPLICATE_TABLE_DETAIL = "Стол с таким номером уже существует в этом месте";

function additionalPriceLabel(type) {
  return type === "hourly" ? "Цена за час" : "Дополнительная цена";
}

// Money display helpers (UZS = integer). RAW state is digit-only; the input
// shows a thousands-grouped view. Never let the grouped string reach the API.
function parseMoneyInput(value) {
  return String(value ?? "").replace(/\D/g, "");
}
function formatMoneyInput(raw) {
  const digits = parseMoneyInput(raw);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
// Phase 5C-2: Hall.price_amount is NUMERIC(15,2), serialized by the backend as
// a decimal STRING ("1000000.00"). Read the integer part only — UZS has no
// sub-unit here — and never parse through a binary float.
function moneyFromApi(value) {
  if (value === null || value === undefined) return "";
  return parseMoneyInput(String(value).split(".")[0]);
}

// Hall.percent is canonical API data. Numeric zero is meaningful, while absent
// values stay absent. Number normalization removes redundant decimal zeroes
// without changing a real fractional percent (10.0 → 10, 10.5 → 10.5).
function formatPercent(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const normalized = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(normalized) ? `${normalized} %` : "";
}

// Directory pricing is sourced only from the structured Phase 5C-2 fields.
// `condition` is deliberately never consulted. Reuse the modal money helpers so
// list and edit views agree on grouping and never expose a NUMERIC ".00" tail.
function placePriceMeta(hall) {
  if (hall?.pricing_type !== "fixed" && hall?.pricing_type !== "hourly") return null;
  if (hall.price_amount === null || hall.price_amount === undefined) return null;
  const rawAmount = moneyFromApi(hall.price_amount);
  if (rawAmount === "") return null;
  return {
    label: additionalPriceLabel(hall.pricing_type),
    amount: formatMoneyInput(rawAmount),
  };
}

// Surface the backend's own domain message when it sent one, otherwise a
// Russian fallback. normalizeApiError sanitizes the text, so an AxiosError or
// raw response can never reach the UI.
function apiErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail !== "string" || !detail.trim()) return fallback;
  return normalizeApiError(error).message || fallback;
}

// Exit-animation duration; kept in sync with the CSS `settings-modal-out`
// keyframe below. Reduced-motion closes immediately.
const MODAL_EXIT_MS = 160;
function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// `price` holds RAW digits for the structured Hall.price_amount column
// (Phase 5C-2). Hall.condition is a legacy human-readable note and is NEVER
// written from here, so an unrelated price edit cannot destroy it.
const EMPTY_HALL_FORM = { name: "", percent: "", pricing_type: "", price: "", is_active: true, branch_id: "" };
const EMPTY_TABLE_FORM = { number: "", capacity: "4", is_active: true };

function tablesLabel(count) {
  const n = Number(count) || 0;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} стол`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} стола`;
  return `${n} столов`;
}

function allTables(hall) {
  return Array.isArray(hall?.tables) ? hall.tables : [];
}
function activeTables(hall) {
  return allTables(hall).filter((t) => t && t.is_active !== false);
}

// Replace the block of halls belonging to `branchId` with `branchHalls` (in the
// given order), leaving every other branch's halls exactly where they are. The
// backend groups a branch's halls contiguously, so this keeps the flat list
// coherent for an optimistic update without a refetch. Exported for unit tests.
export function applyBranchOrder(list, branchId, branchHalls) {
  const result = [];
  let inserted = false;
  for (const hall of list) {
    if (String(hall.branch_id) === String(branchId)) {
      if (!inserted) { result.push(...branchHalls); inserted = true; }
    } else {
      result.push(hall);
    }
  }
  if (!inserted) result.push(...branchHalls);
  return result;
}

function StatusBadge({ active }) {
  return (
    <span className={`settings-status-badge ${active ? "is-active" : "is-inactive"}`}>
      <span className="settings-status-badge__dot" aria-hidden="true" />
      {active ? "Активен" : "Неактивен"}
    </span>
  );
}

// Marjon single-select listbox. The native <select> was replaced because its
// open panel is drawn by the OS (Windows-blue selection, browser chrome) and
// cannot be styled. Same trigger geometry as the form inputs, same menu
// treatment as the OWNER report multi-select (.owner-msel), so it reads as one
// system. The placeholder is trigger text only — never a selectable row.
function MarjonSelect({
  id, value, options, placeholder, label, onChange, onClear,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Outside click closes without touching the chosen value.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openMenu(index = selectedIndex >= 0 ? selectedIndex : 0) {
    setActiveIndex(index);
    setOpen(true);
  }
  function commit(index) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }
  // Escape closes the menu and stops there, so the modal's own Escape handler
  // never tears the form down while the user is only dismissing the dropdown.
  function onKeyDown(event) {
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { openMenu(); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => {
        const next = i + step;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) { openMenu(); return; }
      commit(activeIndex);
    }
  }

  const listId = `${id}-listbox`;
  return (
    <div className={`settings-select${open ? " is-open" : ""}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`settings-select__trigger${selected ? "" : " is-placeholder"}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="settings-select__value">{selected ? selected.label : placeholder}</span>
      </button>
      {selected && onClear ? (
        <button
          type="button"
          className="settings-select__clear"
          aria-label="Убрать доп. цену"
          onClick={() => { onClear(); setOpen(false); }}
        >
          <Icon name="bi-x-lg" size={13} />
        </button>
      ) : (
        <span className="settings-select__chevron" aria-hidden="true"><Icon name="bi-chevron-down" size={15} /></span>
      )}
      {open ? (
        <ul className="settings-select__menu" id={listId} role="listbox" aria-label={label}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`settings-select__option${isSelected ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(index)}
                >
                  <span>{option.label}</span>
                  {isSelected ? <Icon name="bi-check2" size={14} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// Live prefers-reduced-motion subscription for the sortable list (the modal
// uses the one-shot prefersReducedMotion() above; drag needs to react to a
// mid-session OS change without a reload).
function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

// One sortable Place row. Pointer-drag works by pressing on the row body (the
// name/price area) via the sortable's onPointerDown; a plain click there still
// opens Tables (the DndContext uses a small distance activation constraint, so
// a click is not a drag). Keyboard reordering lives on the small grip handle
// (Enter/Space to pick up, arrows to move) so the row body keeps its native
// Enter=open semantics and there is no nested-button. The Edit/Trash controls
// stop pointerdown so they can never start a drag. Reorder changes ONLY order —
// pricing/percent/status markup is byte-for-byte the approved 5C-5 row.
function SortablePlaceRow({
  hall, active, priceMeta, percentText, reducedMotion, disabled,
  onOpen, onEdit, onDelete,
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: String(hall.id), disabled });
  // dnd-kit owns the translate (the allowed inline-transform exception). The
  // subtle lift scale is composed onto that same inline transform so it is not
  // clobbered — and is dropped entirely under reduced motion.
  const translate = CSS.Translate.toString(transform);
  const style = {
    transform: isDragging && !reducedMotion && translate
      ? `${translate} scale(1.012)`
      : translate || undefined,
    transition: reducedMotion ? undefined : transition,
  };
  const className = `settings-place${active ? "" : " is-inactive"}`
    + (isDragging ? " is-dragging" : "")
    + (reducedMotion ? " is-reduced-motion" : "");
  return (
    <article ref={setNodeRef} style={style} className={className}>
      <button
        type="button"
        className="settings-place__main"
        onClick={() => onOpen(hall)}
        onPointerDown={disabled ? undefined : listeners?.onPointerDown}
        aria-label={`Открыть столы: ${hall.name}`}
      >
        <span className="settings-place__info">
          <span className="settings-place__name">{hall.name}</span>
          <span className="settings-place__count">{tablesLabel(activeTables(hall).length)}</span>
        </span>
        <span className="settings-place__price">
          {priceMeta ? <><strong>{priceMeta.label}:</strong>{" "}{priceMeta.amount} UZS</> : null}
        </span>
        <span className="settings-place__percent">{percentText}</span>
      </button>
      <div className="settings-place__meta" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="settings-place__grip"
          ref={setActivatorNodeRef}
          aria-label={`Переместить место: ${hall.name}`}
          title="Перетащите, чтобы изменить порядок"
          {...attributes}
          {...listeners}
        >
          <Icon name="bi-grip-vertical" size={16} />
        </button>
        <StatusBadge active={active} />
        <button type="button" className="settings-place__edit" onClick={() => onEdit(hall)}>Редактировать</button>
        <button type="button" className="settings-action-delete" onClick={() => onDelete(hall)} aria-label="Удалить место"><Icon name="bi-trash3" size={15} /></button>
      </div>
    </article>
  );
}

// One branch = one isolated sortable container. Separate DndContext per branch
// makes cross-branch dragging physically impossible (an item can never leave
// its branch's context), so branch_id is never mutated and a reorder payload
// can never mix branches. Calls onReorder(branchId, orderedHallIds) once, on a
// completed in-branch move.
function PlaceBranchGroup({ branchId, halls, reducedMotion, disabled, onReorder, rowProps }) {
  const sensors = useSensors(
    // 6px threshold: a plain click opens Tables, only real movement drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = useMemo(() => halls.map((h) => String(h.id)), [halls]);
  function onDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(branchId, arrayMove(ids, from, to));
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="settings-places-list">
          {halls.map((hall) => (
            <SortablePlaceRow
              key={hall.id}
              hall={hall}
              reducedMotion={reducedMotion}
              disabled={disabled}
              {...rowProps(hall)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// COMPONENT
export default function SettingsPlacesPage() {
  const [halls, setHalls] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const [hallDrawer, setHallDrawer] = useState(null);
  const [hallForm, setHallForm] = useState(EMPTY_HALL_FORM);
  const [tableDrawer, setTableDrawer] = useState(null);
  const [tableForm, setTableForm] = useState(EMPTY_TABLE_FORM);
  const [saving, setSaving] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  // True only when the backend rejected the exact Phase 5C-3 duplicate-number
  // contract, so the message can be tied to the number input.
  const [numberConflict, setNumberConflict] = useState(false);
  // Phase 5C-6B: true while a reorder PATCH is in flight, so a second drop can
  // be blocked (sortable disabled) without freezing navigation/sidebar.
  const [savingOrder, setSavingOrder] = useState(false);
  // Reorder failures surface HERE (a non-destructive inline banner above the
  // list) rather than in `error`, which replaces the whole list — a rejected
  // drag must keep the user on the Places list with the rolled-back order.
  const [orderError, setOrderError] = useState("");
  const reducedMotion = useReducedMotion();
  // Phase 5C-6D: delete-confirmation modal. `deleteTarget` is the hall pending
  // deletion (null = closed); `deleting` guards double-submit; `deleteError`
  // shows a normalized failure inside the modal without closing it.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [modalClosing, setModalClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimer = useRef(null);
  const beginRequest = useLatestRequest();
  const locks = useMutationLocks();

  // Single controlled close path shared by ×, Отмена, backdrop, Escape and a
  // successful submit: play the exit animation, then unmount after its exact
  // duration. Guarded against duplicate/stale timers so a reopen is never
  // killed by a pending close.
  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setModalClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setHallDrawer(null);
      setTableDrawer(null);
      setDeleteTarget(null);
      setModalClosing(false);
      closingRef.current = false;
    }, prefersReducedMotion() ? 0 : MODAL_EXIT_MS);
  }
  function resetCloseState() {
    clearTimeout(closeTimer.current);
    closingRef.current = false;
    setModalClosing(false);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const selectedHallId = searchParams.get("hall_id") || "";
  const selectedHall = useMemo(
    () => halls.find((h) => String(h.id) === String(selectedHallId)) || null,
    [halls, selectedHallId],
  );
  const inTablesView = Boolean(selectedHallId && selectedHall);
  const hallIsActive = selectedHall?.is_active !== false;
  // Phase 5C-1: a hall is created under the sole ACTIVE branch automatically, so
  // the selector only appears when the choice is genuinely ambiguous (>1). Never
  // a silent branches[0] pick.
  const activeBranches = useMemo(
    () => branches.filter((b) => b && b.is_active !== false),
    [branches],
  );
  const needsBranchChoice = activeBranches.length > 1;
  // HallUpdate has no branch_id, so the branch is READ-ONLY once the hall
  // exists — shown for context only, never as a reassignment control.
  function branchName(branchId) {
    if (!branchId || activeBranches.length < 2) return "";
    return branches.find((b) => String(b.id) === String(branchId))?.name || "";
  }
  // Phase 5C-6B: split the flat, backend-ordered hall list into per-branch
  // blocks (order preserved). Each block is an isolated sortable group so a
  // hall can never be dragged across branches. A branch label is shown only
  // when more than one group exists (disambiguation), never in the single-
  // branch common case — no Settings redesign.
  const placeGroups = useMemo(() => {
    const order = [];
    const byBranch = new Map();
    for (const hall of halls) {
      const key = String(hall.branch_id);
      if (!byBranch.has(key)) { byBranch.set(key, []); order.push(key); }
      byBranch.get(key).push(hall);
    }
    return order.map((key) => ({ branchId: key, halls: byBranch.get(key) }));
  }, [halls]);
  const isMultiBranch = placeGroups.length > 1;
  function groupBranchLabel(branchId) {
    return branches.find((b) => String(b.id) === String(branchId))?.name || "Филиал";
  }

  function load() {
    const request = beginRequest();
    setLoading(true);
    setError("");
    setOrderError("");
    // Phase 5C-4: Settings is an administrative directory, so it asks for the
    // archive explicitly (halls AND their nested tables). Operational surfaces
    // (POS waiter picker, reports) keep the active-only default.
    Promise.all([
      settingsService.listPlaces({ signal: request.signal, params: { include_inactive: true } }),
      settingsService.listBranches({ signal: request.signal }).catch(() => ({ data: [] })),
    ])
      .then(([placesResponse, branchesResponse]) => {
        if (!request.isCurrent()) return;
        const places = placesResponse?.data;
        setHalls(Array.isArray(places) ? places : places?.items || []);
        const rows = branchesResponse?.data;
        setBranches(Array.isArray(rows) ? rows : rows?.items || []);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setHalls([]);
        setError(apiErrorMessage(err, "Не удалось загрузить места."));
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }

  useEffect(() => { load(); }, [beginRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stale/invalid ?hall_id (e.g. after a hall is deactivated) → drop it and
  // fall back to the Places list rather than showing "Столы — undefined".
  useEffect(() => {
    if (!loading && selectedHallId && !halls.some((h) => String(h.id) === String(selectedHallId))) {
      backToList();
    }
  }, [loading, selectedHallId, halls]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes whichever centered modal is open (aria-modal dialog), unless
  // a save is in flight. Backdrop click / × already close via their handlers.
  useEffect(() => {
    if (!hallDrawer && !tableDrawer && !deleteTarget) return undefined;
    function onKey(event) {
      if (event.key !== "Escape" || saving || deleting) return;
      requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hallDrawer, tableDrawer, deleteTarget, saving, deleting]); // eslint-disable-line react-hooks/exhaustive-deps

  function openHall(hall) {
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set("hall_id", hall.id); return p; });
  }
  function backToList() {
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete("hall_id"); return p; });
  }

  // HANDLERS
  function openAddHall() { resetCloseState(); setHallForm(EMPTY_HALL_FORM); setDrawerError(""); setHallDrawer({ mode: "create" }); }
  function openEditHall(hall) {
    resetCloseState();
    setHallForm({
      name: hall.name || "",
      percent: hall.percent == null ? "" : String(hall.percent),
      pricing_type: hall.pricing_type === "hourly" || hall.pricing_type === "fixed" ? hall.pricing_type : "",
      // Phase 5C-2: restored from the structured column, never from condition.
      price: moneyFromApi(hall.price_amount),
      is_active: hall.is_active !== false,
      branch_id: "",
    });
    setDrawerError("");
    setHallDrawer({ mode: "edit", id: hall.id, branch_id: hall.branch_id });
  }
  function hallPayload() {
    const name = hallForm.name.trim();
    if (!name) return null;
    const raw = String(hallForm.percent).trim().replace(",", ".");
    let percent = null;
    if (raw !== "") {
      if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
      percent = Number(raw);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
    }
    const pricing_type = hallForm.pricing_type || null;
    // Phase 5C-2: the structured amount goes to price_amount as a decimal-safe
    // STRING (never a binary float, never the grouped display value). Dropping
    // the extra-price option sends BOTH fields as explicit null, because the
    // backend distinguishes "omitted" from "explicitly cleared" — omitting
    // would leave the stale pricing in place.
    const digits = parseMoneyInput(hallForm.price);
    const price_amount = pricing_type ? (digits || null) : null;
    // condition is deliberately absent from the payload: it is a legacy
    // human-readable note with no field in this form, so it is never written.
    const base = { name, percent, pricing_type, price_amount };
    if (hallDrawer?.mode === "edit") return { ...base, is_active: hallForm.is_active };
    // HallCreate has no is_active (create is always active) and only accepts
    // branch_id — sent solely when the user actually had to choose.
    if (needsBranchChoice && hallForm.branch_id) return { ...base, branch_id: hallForm.branch_id };
    return base;
  }
  async function saveHall(event) {
    event.preventDefault();
    if (!locks.acquire("hall-save")) return;
    const payload = hallPayload();
    if (!payload) { setDrawerError("Укажите название места и корректный процент (0–100)."); locks.release("hall-save"); return; }
    if (hallDrawer?.mode === "create" && needsBranchChoice && !hallForm.branch_id) {
      setDrawerError("Выберите филиал."); locks.release("hall-save"); return;
    }
    setSaving(true); setDrawerError("");
    try {
      if (hallDrawer.mode === "edit") {
        await settingsService.updatePlace(hallDrawer.id, payload);
      } else {
        const created = await settingsService.createPlace(payload);
        // HallCreate cannot express is_active, so "create as inactive" is two
        // truthful steps: create (active), then deactivate the row the server
        // just returned — addressed by canonical Hall.id, never by name.
        if (!hallForm.is_active) {
          const createdId = created?.data?.id;
          if (!createdId) throw new Error("missing created hall id");
          // A failure here must NOT be reported as "created inactive": the
          // place genuinely exists and is genuinely active. Refetch so the list
          // shows that truth, and say what still needs doing.
          try {
            await settingsService.updatePlace(createdId, { is_active: false });
          } catch (patchError) {
            requestClose();
            load();
            setError(apiErrorMessage(
              patchError,
              "Место создано, но осталось активным — деактивируйте его вручную.",
            ));
            return;
          }
        }
      }
      requestClose();
      load();
    } catch (err) { setDrawerError(apiErrorMessage(err, "Не удалось сохранить место.")); }
    finally { setSaving(false); locks.release("hall-save"); }
  }
  // Phase 5C-6D: the Trash action no longer mutates on click — it opens a
  // confirmation modal. Deletion happens only on explicit confirm, and maps to
  // the canonical DELETE /halls/{id} which now ARCHIVES the hall (deleted_at)
  // so the row leaves the Settings directory entirely (never a lingering
  // "Неактивен" row). A failure keeps the modal open with a normalized message
  // and re-enables the button; the mutation lock prevents double-submit.
  function openDeleteConfirm(hall) {
    resetCloseState();
    setDeleteError("");
    setDeleteTarget(hall);
  }
  async function confirmDelete() {
    if (!deleteTarget || !locks.acquire(`hall-del:${deleteTarget.id}`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await settingsService.deactivatePlace(deleteTarget.id);
      requestClose();
      load();
    } catch (err) {
      setDeleteError(apiErrorMessage(err, "Не удалось удалить место."));
    } finally {
      setDeleting(false);
      locks.release(`hall-del:${deleteTarget.id}`);
    }
  }
  // Phase 5C-6B: persist a completed in-branch drag. Optimistically applies the
  // new order, then sends ONE PATCH /halls/reorder with the COMPLETE set of the
  // branch's halls (active + inactive). On success it adopts the canonical
  // returned order; on failure it rolls back to the pre-drag order and shows a
  // normalized message. `orderedIds` is already the whole branch (each group
  // contains all of that branch's halls), so archived halls are never omitted.
  async function reorderBranch(branchId, orderedIds) {
    if (!locks.acquire("reorder")) return;
    const previous = halls;
    const byId = new Map(halls.map((h) => [String(h.id), h]));
    const orderedHalls = orderedIds.map((id) => byId.get(String(id))).filter(Boolean);
    setOrderError("");
    setSavingOrder(true);
    setHalls((cur) => applyBranchOrder(cur, branchId, orderedHalls));
    try {
      const { data } = await settingsService.reorderPlaces({
        branch_id: branchId,
        hall_ids: orderedIds,
      });
      const canonical = Array.isArray(data) ? data : (data?.items || orderedHalls);
      setHalls((cur) => applyBranchOrder(cur, branchId, canonical));
    } catch (err) {
      setHalls(previous); // rollback — never leave a rejected order on screen
      setOrderError(apiErrorMessage(err, "Не удалось сохранить порядок мест."));
    } finally {
      setSavingOrder(false);
      locks.release("reorder");
    }
  }
  // TABLE_HANDLERS
  function openAddTable() { resetCloseState(); setTableForm(EMPTY_TABLE_FORM); setDrawerError(""); setNumberConflict(false); setTableDrawer({ mode: "create" }); }
  function openEditTable(table) {
    resetCloseState();
    setTableForm({
      number: String(table.number ?? ""),
      capacity: String(table.capacity ?? "4"),
      is_active: table.is_active !== false,
    });
    setDrawerError("");
    setNumberConflict(false);
    setTableDrawer({ mode: "edit", tableId: table.id });
  }
  function tablePayload() {
    const number = Number(String(tableForm.number).trim());
    const capacity = Number(String(tableForm.capacity).trim());
    if (!Number.isInteger(number) || number <= 0) return null;
    if (!Number.isInteger(capacity) || capacity <= 0) return null;
    const base = { number, capacity };
    return tableDrawer?.mode === "edit" ? { ...base, is_active: tableForm.is_active } : base;
  }
  const duplicateTableHint = useMemo(() => {
    if (!tableDrawer || !selectedHall) return false;
    const n = Number(String(tableForm.number).trim());
    if (!Number.isInteger(n)) return false;
    // Phase 5C-3 is an ACTIVE-only rule, so an archived #5 is not a clash.
    return activeTables(selectedHall).some((t) => t.number === n && t.id !== tableDrawer.tableId);
  }, [tableDrawer, tableForm.number, selectedHall]);
  async function saveTable(event) {
    event.preventDefault();
    if (!selectedHall || !locks.acquire("table-save")) return;
    const payload = tablePayload();
    if (!payload) { setDrawerError("Укажите номер и вместимость (целые > 0)."); locks.release("table-save"); return; }
    setSaving(true); setDrawerError(""); setNumberConflict(false);
    try {
      if (tableDrawer.mode === "edit") await settingsService.updatePlaceTable(selectedHall.id, tableDrawer.tableId, payload);
      else await settingsService.createPlaceTable(selectedHall.id, payload);
      requestClose();
      load();
    } catch (err) {
      // The conflict stays attached to the form and the entered values survive,
      // so the user can simply change the number. Only the Phase 5C-3
      // duplicate-number contract is tied to the number field; every other 409
      // ("Место неактивно…" etc.) keeps its own canonical wording.
      const message = apiErrorMessage(err, "Не удалось сохранить стол.");
      setNumberConflict(message === DUPLICATE_TABLE_DETAIL);
      setDrawerError(message);
    }
    finally { setSaving(false); locks.release("table-save"); }
  }
  async function deactivateTable(table) {
    if (!selectedHall || !locks.acquire(`table-del:${table.id}`)) return;
    try { await settingsService.deactivatePlaceTable(selectedHall.id, table.id); load(); }
    catch (err) { setError(apiErrorMessage(err, "Не удалось деактивировать стол.")); }
    finally { locks.release(`table-del:${table.id}`); }
  }
  // Phase 5C-4: allowed only under an active hall and only if the number is
  // free among active siblings — the backend is the final authority (409).
  async function reactivateTable(table) {
    if (!selectedHall || !locks.acquire(`table-on:${table.id}`)) return;
    setError("");
    try { await settingsService.updatePlaceTable(selectedHall.id, table.id, { is_active: true }); load(); }
    catch (err) { setError(apiErrorMessage(err, "Не удалось активировать стол.")); }
    finally { locks.release(`table-on:${table.id}`); }
  }

  // RENDER
  function renderPlaces() {
    return (
      <>
        <header className="settings-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>Настройки</p>
              <h1>Места</h1>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={openAddHall}>Добавить место</button>
          </div>
        </header>
        {loading ? (
          <div className="settings-empty-state" role="status">Загрузка...</div>
        ) : error ? (
          <div className="settings-empty-state" role="alert">{error} <button type="button" className="settings-places-retry" onClick={load}>Повторить</button></div>
        ) : !halls.length ? (
          <div className="settings-empty-state settings-places-empty" role="status">
            <span className="settings-places-empty__icon"><Icon name="bi-geo-alt" size={26} /></span>
            <strong>Мест пока нет</strong>
            <span>Добавьте первое место, чтобы настроить зал и столы.</span>
          </div>
        ) : (
          <div className="settings-places-groups">
            {orderError ? <p className="settings-form__error settings-places-order-error" role="alert">{orderError}</p> : null}
            {placeGroups.map((group) => (
              <div className="settings-places-group" key={group.branchId}>
                {isMultiBranch ? (
                  <p className="settings-places-group__label">{groupBranchLabel(group.branchId)}</p>
                ) : null}
                <PlaceBranchGroup
                  branchId={group.branchId}
                  halls={group.halls}
                  reducedMotion={reducedMotion}
                  disabled={savingOrder}
                  onReorder={reorderBranch}
                  rowProps={(hall) => ({
                    active: hall.is_active !== false,
                    priceMeta: placePriceMeta(hall),
                    percentText: formatPercent(hall.percent),
                    onOpen: openHall,
                    onEdit: openEditHall,
                    onDelete: openDeleteConfirm,
                  })}
                />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // RENDER2
  function renderTablesView() {
    // Phase 5C-4: the archive is part of the management view, so archived
    // tables stay listed and individually reactivatable.
    const tables = allTables(selectedHall);
    return (
      <>
        <header className="settings-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div>
              <p>Настройки</p>
              <h1>{selectedHall.name}</h1>
            </div>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              onClick={openAddTable}
              disabled={!hallIsActive}
              title={hallIsActive ? undefined : "Сначала активируйте место"}
            >
              Добавить стол
            </button>
          </div>
        </header>
        {tables.length ? (
          <div className="settings-tbl">
            <div className="settings-tbl__row settings-tbl__head" aria-hidden="true">
              <span>№ стола</span><span>Вместимость</span><span>Статус</span><span>Действия</span>
            </div>
            {tables.map((t) => {
              const active = t.is_active !== false;
              return (
              <div className={`settings-tbl__row${active ? "" : " is-inactive"}`} key={t.id}>
                <div className="settings-tbl__cell"><span className="settings-tbl__label">Стол</span><strong>№{t.number}</strong></div>
                <div className="settings-tbl__cell"><span className="settings-tbl__label">Вместимость</span>{t.capacity}</div>
                <div className="settings-tbl__cell"><StatusBadge active={active} /></div>
                <div className="settings-tbl__cell settings-tbl__act">
                  <button type="button" className="settings-place__edit" onClick={() => openEditTable(t)}>Редактировать</button>
                  {active ? (
                    <button type="button" className="settings-action-delete" onClick={() => deactivateTable(t)} aria-label="Деактивировать стол"><Icon name="bi-trash3" size={15} /></button>
                  ) : (
                    <button
                      type="button"
                      className="settings-action-restore"
                      onClick={() => reactivateTable(t)}
                      disabled={!hallIsActive}
                      aria-label="Активировать стол"
                      title={hallIsActive ? undefined : "Сначала активируйте место"}
                    >
                      <Icon name="bi-arrow-counterclockwise" size={15} />
                    </button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          <div className="settings-empty-state settings-places-empty" role="status">
            <span className="settings-places-empty__icon"><Icon name="bi-grid-3x3-gap" size={24} /></span>
            <strong>Столов пока нет</strong>
            <span>Добавьте первый стол для этого места.</span>
          </div>
        )}
      </>
    );
  }

  // RENDER3
  return (
    <div className="settings-page settings-places-page settings-owner-view">
      <section className="settings-card">
        {inTablesView ? renderTablesView() : renderPlaces()}
      </section>

      {hallDrawer ? createPortal((
        <div className="settings-owner-view settings-drawer-layer">
          <div className={`settings-drawer settings-modal-overlay${modalClosing ? " is-closing" : ""}`} role="presentation">
          <div className="settings-drawer__backdrop" onClick={saving ? undefined : requestClose} />
          <form className="settings-form settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-hall-modal-title" onSubmit={saveHall}>
            <header className="settings-form__header">
              <span className="settings-accent-bar" />
              <div><p>{hallDrawer.mode === "edit" ? "Редактировать" : "Добавить"}</p><h2 id="settings-hall-modal-title">{hallDrawer.mode === "edit" ? "Редактировать место" : "Добавить место"}</h2></div>
              <button type="button" disabled={saving} onClick={requestClose} aria-label="Закрыть"><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="settings-form__body">
              <label className="settings-form__wide"><span>Название места</span><input autoFocus value={hallForm.name} placeholder="Введите название места" onChange={(e) => setHallForm((f) => ({ ...f, name: e.target.value }))} /></label>
              {/* Phase 5C-1: only shown when there is a real choice to make. With
                  a single active branch the backend resolves it server-side. */}
              {hallDrawer.mode === "create" && needsBranchChoice ? (
                <div className="settings-form__wide settings-field">
                  <label className="settings-field__label" htmlFor="hall-branch-select">Филиал</label>
                  <MarjonSelect
                    id="hall-branch-select"
                    label="Филиал"
                    placeholder="Выберите филиал..."
                    value={hallForm.branch_id}
                    options={activeBranches.map((b) => ({ value: b.id, label: b.name }))}
                    onChange={(next) => setHallForm((f) => ({ ...f, branch_id: next }))}
                  />
                </div>
              ) : null}
              {hallDrawer.mode === "edit" && branchName(hallDrawer.branch_id) ? (
                <p className="settings-form__context settings-form__wide">Филиал: <strong>{branchName(hallDrawer.branch_id)}</strong></p>
              ) : null}
              <label className="settings-form__wide"><span>% обслуживания в заведении</span><input value={hallForm.percent} inputMode="decimal" placeholder="Введите %" onChange={(e) => setHallForm((f) => ({ ...f, percent: e.target.value }))} /></label>
              {/* The hint is trigger text, not a row in the panel, so it can
                  never be chosen. Clearing goes through the × control, which is
                  what produces the explicit Phase 5C-2 nulls. */}
              <div className="settings-form__wide settings-field">
                <label className="settings-field__label" htmlFor="hall-pricing-select">Доп. цена</label>
                <MarjonSelect
                  id="hall-pricing-select"
                  label="Доп. цена"
                  placeholder={PRICING_PLACEHOLDER}
                  value={hallForm.pricing_type}
                  options={ADDITIONAL_PRICE_TYPES}
                  onChange={(next) => setHallForm((f) => ({ ...f, pricing_type: next }))}
                  onClear={() => setHallForm((f) => ({ ...f, pricing_type: "", price: "" }))}
                />
              </div>
              {hallForm.pricing_type ? (
                <label className="settings-form__wide settings-form__conditional"><span>{additionalPriceLabel(hallForm.pricing_type)}</span><input value={formatMoneyInput(hallForm.price)} inputMode="numeric" placeholder="Введите цену" onChange={(e) => setHallForm((f) => ({ ...f, price: parseMoneyInput(e.target.value) }))} /></label>
              ) : null}
              {/* Status is interactive in BOTH modes. HallCreate has no
                  is_active field, so "create as inactive" is honoured as
                  POST (active) → PATCH {is_active:false} on the returned id —
                  see saveHall. Never a frontend-only pretend state. */}
              <div className="settings-toggle-field settings-form__wide">
                <span>Статус</span>
                <label className="settings-switch">
                  <input type="checkbox" checked={hallForm.is_active} onChange={(e) => setHallForm((f) => ({ ...f, is_active: e.target.checked }))} />
                  <span className="settings-switch__track" aria-hidden="true"><span className="settings-switch__thumb" /></span>
                  <span className={`settings-switch__label ${hallForm.is_active ? "is-active" : "is-inactive"}`}>{hallForm.is_active ? "Активен" : "Неактивен"}</span>
                </label>
              </div>
            </div>
            {drawerError ? <p className="settings-form__error" role="alert">{drawerError}</p> : null}
            <footer className="settings-form__footer">
              <button type="button" disabled={saving} onClick={requestClose}>Отмена</button>
              <button type="submit" disabled={saving}>{saving ? "Сохранение..." : hallDrawer.mode === "edit" ? "Сохранить" : "Добавить"}</button>
            </footer>
          </form>
          </div>
        </div>
      ), document.body) : null}

      {/* TABLE_DRAWER */}
      {tableDrawer && selectedHall ? createPortal((
        <div className="settings-owner-view settings-drawer-layer">
          <div className={`settings-drawer settings-modal-overlay${modalClosing ? " is-closing" : ""}`} role="presentation">
          <div className="settings-drawer__backdrop" onClick={saving ? undefined : requestClose} />
          <form className="settings-form settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-table-modal-title" onSubmit={saveTable}>
            <header className="settings-form__header">
              <span className="settings-accent-bar" />
              <div><p>{tableDrawer.mode === "edit" ? "Редактировать" : "Добавить"}</p><h2 id="settings-table-modal-title">{tableDrawer.mode === "edit" ? "Редактировать стол" : "Добавить стол"}</h2></div>
              <button type="button" disabled={saving} onClick={requestClose} aria-label="Закрыть"><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="settings-form__body">
              <p className="settings-form__context">Место: <strong>{selectedHall.name}</strong></p>
              {!hallIsActive ? (
                <p className="settings-form__hint" role="status">Место неактивно — сначала активируйте место.</p>
              ) : null}
              <label className="settings-form__wide"><span>Номер стола</span><input autoFocus value={tableForm.number} inputMode="numeric" placeholder="Введите номер" aria-invalid={numberConflict || undefined} onChange={(e) => { setNumberConflict(false); setTableForm((f) => ({ ...f, number: e.target.value })); }} /></label>
              <label className="settings-form__wide"><span>Вместимость</span><input value={tableForm.capacity} inputMode="numeric" onChange={(e) => setTableForm((f) => ({ ...f, capacity: e.target.value }))} /></label>
              {tableDrawer.mode === "edit" ? (
                <div className="settings-toggle-field settings-form__wide">
                  <span>Статус</span>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={tableForm.is_active}
                      disabled={!hallIsActive && !tableForm.is_active}
                      onChange={(e) => setTableForm((f) => ({ ...f, is_active: e.target.checked }))}
                    />
                    <span className="settings-switch__track" aria-hidden="true"><span className="settings-switch__thumb" /></span>
                    <span className={`settings-switch__label ${tableForm.is_active ? "is-active" : "is-inactive"}`}>{tableForm.is_active ? "Активен" : "Неактивен"}</span>
                  </label>
                </div>
              ) : null}
            </div>
            {duplicateTableHint ? <p className="settings-form__hint" role="status">Стол с таким номером уже есть в этом месте.</p> : null}
            {drawerError ? <p className="settings-form__error" role="alert">{drawerError}</p> : null}
            <footer className="settings-form__footer">
              <button type="button" disabled={saving} onClick={requestClose}>Отмена</button>
              <button type="submit" disabled={saving}>{saving ? "Сохранение..." : tableDrawer.mode === "edit" ? "Сохранить" : "Добавить"}</button>
            </footer>
          </form>
          </div>
        </div>
      ), document.body) : null}

      {/* DELETE_CONFIRM — reuses the exact modal shell/animation as Add/Edit
          (portal to body, .settings-modal-overlay backdrop + open/close
          keyframes, radius, shadow, Escape/backdrop close). Compact confirm
          content; the destructive CTA is danger-red, Отмена is the neutral
          Marjon outline. Отмена is auto-focused so Enter never deletes. */}
      {deleteTarget ? createPortal((
        <div className="settings-owner-view settings-drawer-layer">
          <div className={`settings-drawer settings-modal-overlay${modalClosing ? " is-closing" : ""}`} role="presentation">
          <div className="settings-drawer__backdrop" onClick={deleting ? undefined : requestClose} />
          <div className="settings-form settings-modal settings-confirm" role="dialog" aria-modal="true" aria-labelledby="settings-delete-modal-title" aria-describedby="settings-delete-modal-body">
            <header className="settings-form__header">
              <span className="settings-accent-bar" />
              <div><p>Удаление</p><h2 id="settings-delete-modal-title">Удалить место?</h2></div>
              <button type="button" disabled={deleting} onClick={requestClose} aria-label="Закрыть"><Icon name="bi-x-lg" size={20} /></button>
            </header>
            <div className="settings-form__body">
              <p id="settings-delete-modal-body" className="settings-confirm__text">
                Вы уверены, что хотите удалить «<strong>{deleteTarget.name}</strong>»?
              </p>
            </div>
            {deleteError ? <p className="settings-form__error" role="alert">{deleteError}</p> : null}
            <footer className="settings-form__footer">
              <button type="button" autoFocus disabled={deleting} onClick={requestClose}>Отмена</button>
              <button type="button" className="settings-confirm__delete" disabled={deleting} onClick={confirmDelete}>{deleting ? "Удаление..." : "Удалить"}</button>
            </footer>
          </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}
