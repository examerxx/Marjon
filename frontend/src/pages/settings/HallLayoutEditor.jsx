import { useEffect, useRef, useState } from "react";

// Канва схемы зала в условных единицах. Стол хранит левый верхний угол (x,y),
// один и тот же масштаб используют конструктор и касса.
export const LAYOUT_WIDTH = 1000;
export const LAYOUT_HEIGHT = 620;
const TILE_W = 140;
const TILE_H = 100;
const GAP = 20;
const SNAP = 10;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function snap(value) {
  return Math.round(value / SNAP) * SNAP;
}

// Аккуратная сетка для «Расставить сеткой» и для новых столов без координат.
function gridSlot(index) {
  const cols = Math.max(1, Math.floor((LAYOUT_WIDTH - GAP) / (TILE_W + GAP)));
  return {
    x: GAP + (index % cols) * (TILE_W + GAP),
    y: GAP + Math.floor(index / cols) * (TILE_H + GAP),
  };
}

function isPlaced(table) {
  return Number.isFinite(table?.x) && Number.isFinite(table?.y);
}

export default function HallLayoutEditor({ tables, onSave, disabled = false }) {
  const [positions, setPositions] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draggingId, setDraggingId] = useState(null);
  const dragRef = useRef(null);
  const canvasRef = useRef(null);

  // Сохранённые координаты остаются как есть, новые столы получают свободное
  // место сетки. Пересчитываем только когда изменился сам набор столов —
  // иначе перетаскивание сбрасывалось бы на каждом рендере.
  const tableKey = tables
    .map((t) => `${t.id}:${t.x ?? ""}:${t.y ?? ""}:${t.number}`)
    .join("|");
  useEffect(() => {
    setPositions(() => {
      const next = {};
      const taken = new Set();
      const queue = [];
      for (const table of tables) {
        if (isPlaced(table)) {
          next[table.id] = { x: table.x, y: table.y };
          taken.add(`${table.x},${table.y}`);
        } else {
          queue.push(table);
        }
      }
      let index = 0;
      for (const table of queue) {
        let slot = gridSlot(index++);
        while (taken.has(`${slot.x},${slot.y}`)) slot = gridSlot(index++);
        taken.add(`${slot.x},${slot.y}`);
        next[table.id] = slot;
      }
      return next;
    });
    setDirty(queueNeedsSave(tables));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey]);

  function queueNeedsSave(list) {
    return list.some((table) => !isPlaced(table));
  }

  function moveTo(id, x, y) {
    setPositions((prev) => ({ ...prev, [id]: { x, y } }));
    setDirty(true);
  }

  function startDrag(event, id) {
    if (disabled || saving) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const origin = positions[id];
    if (!origin) return;
    dragRef.current = {
      id,
      origin,
      startX: event.clientX,
      startY: event.clientY,
      scaleX: LAYOUT_WIDTH / Math.max(rect.width, 1),
      scaleY: LAYOUT_HEIGHT / Math.max(rect.height, 1),
    };
    setDraggingId(id);
  }

  function dragMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) * drag.scaleX;
    const dy = (event.clientY - drag.startY) * drag.scaleY;
    const x = clamp(snap(drag.origin.x + dx), 0, LAYOUT_WIDTH - TILE_W);
    const y = clamp(snap(drag.origin.y + dy), 0, LAYOUT_HEIGHT - TILE_H);
    moveTo(drag.id, x, y);
  }

  function endDrag(event) {
    if (!dragRef.current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDraggingId(null);
  }

  function nudge(event, id) {
    const step = event.shiftKey ? 50 : 10;
    const delta = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      ArrowUp: [0, -step], ArrowDown: [0, step],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    const current = positions[id];
    if (!current) return;
    moveTo(
      id,
      clamp(current.x + delta[0], 0, LAYOUT_WIDTH - TILE_W),
      clamp(current.y + delta[1], 0, LAYOUT_HEIGHT - TILE_H),
    );
  }

  function tidyAll() {
    const next = {};
    tables.forEach((table, index) => { next[table.id] = gridSlot(index); });
    setPositions(next);
    setDirty(true);
  }

  async function save() {
    if (saving || disabled) return;
    setSaving(true);
    setError("");
    try {
      await onSave(tables.map((table) => ({ id: table.id, ...positions[table.id] })));
      setDirty(false);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" && detail.trim() ? detail : "Не удалось сохранить схему.");
    } finally {
      setSaving(false);
    }
  }

  if (!tables.length) return null;

  return (
    <section className="settings-hall-plan">
      <header className="settings-hall-plan__head">
        <div>
          <h2>Схема зала</h2>
          <p>Перетащите столы в нужные места — касса покажет зал так же.</p>
        </div>
        <div className="settings-hall-plan__actions">
          <button type="button" onClick={tidyAll} disabled={disabled || saving}>Расставить сеткой</button>
          <button type="button" className="is-primary" onClick={save} disabled={disabled || saving || !dirty}>
            {saving ? "Сохранение..." : "Сохранить схему"}
          </button>
        </div>
      </header>
      <div className="settings-hall-plan__canvas" ref={canvasRef}>
        {tables.map((table) => {
          const pos = positions[table.id];
          if (!pos) return null;
          return (
            <button
              type="button"
              key={table.id}
              className={`settings-hall-plan__table${draggingId === table.id ? " is-dragging" : ""}`}
              style={{
                left: `${(pos.x / LAYOUT_WIDTH) * 100}%`,
                top: `${(pos.y / LAYOUT_HEIGHT) * 100}%`,
                width: `${(TILE_W / LAYOUT_WIDTH) * 100}%`,
                height: `${(TILE_H / LAYOUT_HEIGHT) * 100}%`,
              }}
              onPointerDown={(event) => startDrag(event, table.id)}
              onPointerMove={dragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => nudge(event, table.id)}
              aria-label={`Стол ${table.number}, ${table.capacity} мест`}
            >
              <span className="settings-hall-plan__number">№{table.number}</span>
              <span className="settings-hall-plan__capacity">{table.capacity} мест</span>
            </button>
          );
        })}
      </div>
      {error ? <p className="settings-form__error" role="alert">{error}</p> : null}
    </section>
  );
}
