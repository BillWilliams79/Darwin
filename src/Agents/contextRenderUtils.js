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

// Render order within a run: sort_order ASC (NULLs last), then id.
export function sortRows(rows) {
    return [...(rows || [])].sort(
        (a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || a.id - b.id);
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
        swc: fmt(row.start_work_context_tokens),   // always present — bold teal
    };
}
