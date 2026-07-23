// Grid geometry for the mode-driven requirement-row columns (req #3029).
//
// The pill / text / compact display mode governs FOUR value columns — Status,
// Autonomy, Model, Effort — wherever the enhanced columns are shown (the
// aggregator always; category cards when the user opts in). 'compact' reproduces
// today's look exactly: Status/Autonomy are their small icons and Model/Effort
// are single-letter chips.
//
// Each RequirementRow is its OWN CSS grid (`.task { display:grid }`), so column
// tracks do NOT share sizing across rows automatically — vertical alignment
// within a card holds only because every row uses the SAME template. That means
// these tracks must be FIXED widths (never `auto`), otherwise a row with a wide
// value ("Implementing" / "Ultracode") would misalign against a narrow one.
//
// Widths are per display-mode, sized to the widest label each column must hold:
//   • Status  — "Implementing" (session) / "Swarm-Start" (requirement)
//   • Autonomy — "Implemented"
//   • Effort  — "Ultracode"
//   • Model   — "Sonnet"
// 'compact' keeps Status/Autonomy at the icon width (28px) they use today.

export const MODEL_EFFORT_COL_WIDTHS = {
    pill:    { status: 116, autonomy: 112, model: 66, effort: 88 },
    compact: { status: 28,  autonomy: 28,  model: 30, effort: 30 },
};

// Base (no mode columns) row templates — mirror the CSS in index.css so this
// module is the single source of truth when the columns ARE injected.
//   category  : Req# · Status · Autonomy · Title · delete
//   aggregator: color-bar · Req# · Status · Autonomy · Title · delete
const BASE_CATEGORY = ['56px', '28px', '28px', '1fr', 'auto'];
const BASE_AGGREGATOR = ['24px', '56px', '28px', '28px', '1fr', 'auto'];

// Build the `grid-template-columns` value for a row rendering the mode columns.
// The five value tracks (Req# always 56px; Status/Autonomy/Model/Effort at their
// per-mode widths) are arranged per `columnOrder`:
//   'standard'   : … · Req# · Status · Autonomy · Model · Effort · Title · delete
//   'meFirst'    : … · Model · Effort · Req# · Status · Autonomy · Title · delete
//   'meAfterReq' : … · Req# · Model · Effort · Status · Autonomy · Title · delete
// The color-bar (aggregator only) always stays leftmost. The rendered cell order
// in RequirementRow mirrors this exactly.
//
// Returns a space-joined string suitable for the `--me-grid` custom property.
export const modelEffortGridTemplate = ({ isAggregatorRow, displayMode, columnOrder }) => {
    const w = MODEL_EFFORT_COL_WIDTHS[displayMode] || MODEL_EFFORT_COL_WIDTHS.pill;
    const req = '56px';
    const status = `${w.status}px`;
    const autonomy = `${w.autonomy}px`;
    const model = `${w.model}px`;
    const effort = `${w.effort}px`;
    let ordered;
    if (columnOrder === 'meFirst') {
        ordered = [model, effort, req, status, autonomy];
    } else if (columnOrder === 'meAfterReq') {
        ordered = [req, model, effort, status, autonomy];
    } else { // 'standard'
        ordered = [req, status, autonomy, model, effort];
    }
    const bar = isAggregatorRow ? ['24px'] : [];
    return [...bar, ...ordered, '1fr', 'auto'].join(' ');
};

// Exposed for tests: the base templates the CSS provides when the columns are
// NOT injected (so the count-of-tracks assertions have a reference point).
export const baseGridTemplate = ({ isAggregatorRow }) =>
    (isAggregatorRow ? BASE_AGGREGATOR : BASE_CATEGORY).join(' ');
