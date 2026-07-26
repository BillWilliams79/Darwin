// Pure render decisions for /agents/context (req #3031), extracted so the
// artifact-faithful cell logic (NULL → "n/a", bundled-stub → footnote marker,
// docs "loaded / expected", marker assignment) is unit-testable without a DOM.
// The component turns these primitives into JSX.

// Footnote markers, assigned in row order to each DISTINCT footnote text.
export const MARKERS = ['*', '†', '‡', '§', '¶', '#'];

// The sentinel a cell carries when a phase does not apply. The component renders
// it muted; here it is a plain string so tests can assert on it.
export const NA = 'n/a';

export function fmt(n) {
    return (n === null || n === undefined) ? null : Number(n).toLocaleString('en-US');
}

// Column -> comparator ingredients for the interactive header-click sort
// (req #3065). `type` picks string vs. numeric comparison; `get` pulls the
// raw (possibly null) value straight off the row. Keys match the `field`
// strings the component's <th> onClick handlers pass.
const SORT_COLUMNS = {
    agent_name: { type: 'string', get: (r) => r.agent_name },
    boot_time_ms: { type: 'number', get: (r) => r.boot_time_ms },
    cc_base_tokens: { type: 'number', get: (r) => r.cc_base_tokens },
    claude_md_tokens: { type: 'number', get: (r) => r.claude_md_tokens },
    charter_stub_tokens: { type: 'number', get: (r) => r.charter_stub_tokens },
    boot_payload_tokens: { type: 'number', get: (r) => r.boot_payload_tokens },
    autoload_tokens: { type: 'number', get: (r) => r.autoload_tokens },
    docs_loaded: { type: 'number', get: (r) => r.docs_loaded },
    start_work_context_tokens: { type: 'number', get: (r) => r.start_work_context_tokens },
};

export const DEFAULT_SORT_FIELD = 'agent_name';
export const DEFAULT_SORT_DIR = 'asc';

// The direction a NEWLY clicked column starts in (req #3065 refinement):
// numeric columns default to descending (largest first — the interesting end
// of a token count), string columns to ascending (A→Z). Flipping the ALREADY
// active column still just toggles, regardless of type.
export function naturalSortDir(field) {
    const col = SORT_COLUMNS[field] || SORT_COLUMNS[DEFAULT_SORT_FIELD];
    return col.type === 'string' ? 'asc' : 'desc';
}

// Agent-name pin order (req #3065 pt 2): certain roles always sort first
// alphabetically regardless of their literal name string. Today just Darwin
// PrimaryAI (rank 0); a future "swarm session" role is expected to slot in
// second (rank 1) — extend this map, not the comparator, when that lands.
// Every other role shares the fallback rank and sorts by its literal name.
const AGENT_NAME_RANK = { primary: 0 };
const AGENT_NAME_RANK_DEFAULT = 99;

function agentNameRank(row) {
    return AGENT_NAME_RANK[row.role] ?? AGENT_NAME_RANK_DEFAULT;
}

// Sort by one clicked column. NULLs sort last regardless of direction, so
// flipping asc/desc never scatters the "n/a" rows to the top — only the
// non-null values change places. Ties (including both-null) break by id so
// re-render order stays stable while the underlying data is unchanged.
export function sortByColumn(rows, field, dir) {
    const col = SORT_COLUMNS[field] || SORT_COLUMNS[DEFAULT_SORT_FIELD];
    const mul = dir === 'desc' ? -1 : 1;
    // Compare by identity, not by the raw `field` string, so an unknown field
    // that falls back to the agent_name column (above) also gets the pin
    // below — the fallback means "behave as if sorting by agent name," and
    // that behavior includes the pin now, not just the column's get/type.
    const isAgentName = col === SORT_COLUMNS.agent_name;
    return [...(rows || [])].sort((a, b) => {
        // Agent name carries one extra rule ahead of plain alphabetical
        // order: the pinned roles above always sort first alphabetically,
        // regardless of their literal string. `mul` applies here exactly as
        // it does to every other comparison on this column, so reversing
        // direction reverses this too — PrimaryAI is the top row ascending,
        // the bottom row descending, not a fixed exception to the direction.
        if (isAgentName) {
            const rankCmp = agentNameRank(a) - agentNameRank(b);
            if (rankCmp !== 0) return mul * rankCmp;
        }
        const av = col.get(a);
        const bv = col.get(b);
        const aNull = av === null || av === undefined;
        const bNull = bv === null || bv === undefined;
        if (aNull && bNull) return a.id - b.id;
        if (aNull) return 1;
        if (bNull) return -1;
        const cmp = col.type === 'string'
            ? String(av).localeCompare(String(bv))
            : av - bv;
        return cmp !== 0 ? mul * cmp : a.id - b.id;
    });
}

// Human label for a run: "{label} — {YYYY-MM-DD}", or bare label if uncaptured.
// Shared by the page (Capture picker) and the delete dialog (mini preview).
export function runDateLabel(run) {
    if (!run) return '';
    const d = run.captured_at ? String(run.captured_at).slice(0, 10) : '';
    return d ? `${run.label} — ${d}` : run.label;
}

// Map each distinct footnote text → its marker, in sorted-row order. Rows with
// no footnote contribute nothing; a repeated footnote reuses its first marker.
// Past the symbol set (>6 distinct footnotes in one run) fall back to a bracketed
// index so markers never collide (a plain '*' repeat would alias the first note).
export function assignMarkers(sortedRows) {
    const m = new Map();
    for (const r of sortedRows) {
        if (r.footnote && !m.has(r.footnote)) {
            m.set(r.footnote, MARKERS[m.size] || `[${m.size + 1}]`);
        }
    }
    return m;
}

// Resolve every cell for one row into display primitives. `markerByText` comes
// from assignMarkers over the same run.
export function computeCells(row, markerByText) {
    const marker = row.footnote ? (markerByText.get(row.footnote) || null) : null;
    const num = (v) => (v !== null && v !== undefined ? fmt(v) : NA);
    return {
        isPrimary: row.role === 'primary',
        bootMs: num(row.boot_time_ms),
        ccBase: num(row.cc_base_tokens),
        ccBaseMarker: marker,                      // superscript appended to CC base
        claudeMd: num(row.claude_md_tokens),
        // Charter stub: a real number when present; the footnote marker when the
        // agent BUNDLES its stub into CC base (reviewer); otherwise n/a (primary).
        stub: row.charter_stub_tokens !== null && row.charter_stub_tokens !== undefined
            ? { kind: 'value', text: fmt(row.charter_stub_tokens) }
            : (row.role === 'reviewer'
                ? { kind: 'marker', text: marker }
                : { kind: 'na', text: NA }),
        bootPayload: num(row.boot_payload_tokens),
        autoload: num(row.autoload_tokens),
        docs: (row.docs_loaded !== null && row.docs_loaded !== undefined
               && row.docs_expected !== null && row.docs_expected !== undefined)
            ? `${row.docs_loaded} / ${row.docs_expected}` : NA,
        // True only when both counts are known AND loaded falls short — a
        // context-creation defect worth flagging in red. Neither count known
        // (n/a, e.g. PrimaryAI) is not a defect and stays unflagged.
        docsIncomplete: (row.docs_loaded !== null && row.docs_loaded !== undefined
               && row.docs_expected !== null && row.docs_expected !== undefined)
            ? row.docs_loaded < row.docs_expected : false,
        swc: fmt(row.start_work_context_tokens),   // always present — bold teal
    };
}
