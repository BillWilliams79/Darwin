// Grid geometry for the Model + Effort requirement-row columns (req #3029;
// simplified in req #3043 — the display-mode and column-order options were
// removed, so this module now builds exactly one layout).
//
// The enhanced columns add Model + Effort (pills) to the row wherever they are
// shown (the aggregator always; category cards when the user opts in), always in
// the standard order: Req# · Status · Autonomy · Model · Effort. Status and
// Autonomy render as small ICONS (req #3046), NOT pills — so they keep the same
// 28px icon tracks the base (no-Model/Effort) templates use; only Model and
// Effort need pill-sized tracks.
//
// Each RequirementRow is its OWN CSS grid (`.task { display:grid }`), so column
// tracks do NOT share sizing across rows automatically — vertical alignment
// within a card holds only because every row uses the SAME template. That means
// these tracks must be FIXED widths (never `auto`), otherwise a row with a wide
// value ("Ultracode") would misalign against a narrow one.
//
// Widths are sized to the widest label each column must hold:
//   • Status  — 28px icon (matches base template)
//   • Autonomy — 28px icon (matches base template)
//   • Effort  — "Ultracode"
//   • Model   — "Sonnet"

export const MODEL_EFFORT_COL_WIDTHS = { status: 28, autonomy: 28, model: 66, effort: 88 };

// Base (no mode columns) row templates — mirror the CSS in index.css so this
// module is the single source of truth when the columns ARE injected.
//   category  : Req# · Status · Autonomy · Title · delete
//   aggregator: color-bar · Req# · Status · Autonomy · Title · delete
const BASE_CATEGORY = ['56px', '28px', '28px', '1fr', 'auto'];
const BASE_AGGREGATOR = ['24px', '56px', '28px', '28px', '1fr', 'auto'];

// Build the `grid-template-columns` value for a row rendering the Model/Effort
// columns: … · Req# · Status · Autonomy · Model · Effort · Title · delete. The
// color-bar (aggregator only) always stays leftmost. The rendered cell order
// in RequirementRow mirrors this exactly.
//
// Returns a space-joined string suitable for the `--me-grid` custom property.
export const modelEffortGridTemplate = ({ isAggregatorRow }) => {
    const w = MODEL_EFFORT_COL_WIDTHS;
    const req = '56px';
    const status = `${w.status}px`;
    const autonomy = `${w.autonomy}px`;
    const model = `${w.model}px`;
    const effort = `${w.effort}px`;
    const ordered = [req, status, autonomy, model, effort];
    const bar = isAggregatorRow ? ['24px'] : [];
    return [...bar, ...ordered, '1fr', 'auto'].join(' ');
};

// Exposed for tests: the base templates the CSS provides when the columns are
// NOT injected (so the count-of-tracks assertions have a reference point).
export const baseGridTemplate = ({ isAggregatorRow }) =>
    (isAggregatorRow ? BASE_AGGREGATOR : BASE_CATEGORY).join(' ');
