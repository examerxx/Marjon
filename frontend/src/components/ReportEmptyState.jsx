import emptyIllustration from "../assets/reports/report-empty-state.png";

// Preload + decode the canonical empty-state PNG ONCE at module load, so it is
// already in the browser cache and decoded before any report subcategory
// transition mounts its own <img>. This guarantees the empty state never waits
// on image network/decode when a report confirms zero rows.
if (typeof window !== "undefined" && typeof Image !== "undefined") {
  const preload = new Image();
  preload.src = emptyIllustration;
  if (typeof preload.decode === "function") preload.decode().catch(() => {});
}

// Shared OWNER Reports empty state (universal illustration phase).
// One 3D asset for every ordinary report; only the business title varies.
// The image is decorative — the title carries the meaning.
//
// `loading` renders a truthful in-body loading treatment (no PNG, no title) so
// the tbody is never blank while the first GET is pending — the empty PNG/title
// is shown ONLY once the backend has confirmed zero rows. `hidden` keeps the
// legacy visibility-hidden behaviour for callers that still use it.
export default function ReportEmptyState({ title, hidden = false, loading = false }) {
  if (loading) {
    return (
      <div className="owner-report-empty owner-report-empty--illustrated owner-report-empty--loading" role="status" aria-live="polite">
        <span className="owner-report-empty-loading">Загрузка…</span>
      </div>
    );
  }
  return (
    <div
      className="owner-report-empty owner-report-empty--illustrated"
      role="status"
      style={hidden ? { visibility: "hidden" } : undefined}
    >
      <img
        className="owner-report-empty-image"
        src={emptyIllustration}
        alt=""
        aria-hidden="true"
      />
      <div className="owner-report-empty-text">
        <strong className="owner-report-empty-title">{title}</strong>
      </div>
    </div>
  );
}
