import emptyIllustration from "../assets/reports/report-empty-state.png";

// Shared OWNER Reports empty state (universal illustration phase).
// One 3D asset for every ordinary report; only the business title varies.
// The image is decorative — the title carries the meaning.
export default function ReportEmptyState({ title, hidden = false }) {
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
