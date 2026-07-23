// Req #3031 — the artifact-faithful cell decisions for /agents/context.
// Uses the seeded 2026-07-22 baseline rows as the fixture so the test doubles as
// a regression guard against the published visual-acceptance spec.

import { describe, it, expect } from 'vitest';
import { fmt, NA, sortRows, assignMarkers, computeCells } from '../contextRenderUtils';

const architect = (over) => ({
    id: 1, agent_name: 'AWS', role: 'architect', session_kind: 'subagent',
    boot_time_ms: 388, cc_base_tokens: 15401, claude_md_tokens: 10033,
    charter_stub_tokens: 1821, boot_payload_tokens: 4973, autoload_tokens: 6768,
    docs_loaded: 4, docs_expected: 4, start_work_context_tokens: 38996,
    footnote: null, sort_order: 1, ...over,
});

const reviewer = {
    id: 12, agent_name: 'Code Reviewer', role: 'reviewer', session_kind: 'subagent',
    boot_time_ms: 358, cc_base_tokens: 6230, claude_md_tokens: 10033,
    charter_stub_tokens: null, boot_payload_tokens: 3240, autoload_tokens: 148,
    docs_loaded: 0, docs_expected: 1, start_work_context_tokens: 19651,
    footnote: 'Code Reviewer pins tools ...; charter stub bundled into CC base.',
    sort_order: 12,
};

const primary = {
    id: 13, agent_name: 'Darwin PrimaryAI', role: 'primary', session_kind: 'top_level',
    boot_time_ms: null, cc_base_tokens: 24526, claude_md_tokens: 10033,
    charter_stub_tokens: null, boot_payload_tokens: null, autoload_tokens: null,
    docs_loaded: null, docs_expected: null, start_work_context_tokens: 34559,
    footnote: 'Darwin PrimaryAI is a top-level session (no boot/autoload phase) ...',
    sort_order: 99,
};

describe('fmt', () => {
    it('adds thousands separators', () => {
        expect(fmt(15401)).toBe('15,401');
        expect(fmt(200805)).toBe('200,805');
    });
    it('returns null for null/undefined', () => {
        expect(fmt(null)).toBeNull();
        expect(fmt(undefined)).toBeNull();
    });
});

describe('sortRows', () => {
    it('orders by sort_order, NULLs last, then id', () => {
        const out = sortRows([
            { id: 3, sort_order: null }, { id: 1, sort_order: 99 },
            { id: 2, sort_order: 1 },
        ]);
        expect(out.map(r => r.id)).toEqual([2, 1, 3]);
    });
    it('does not mutate input', () => {
        const input = [{ id: 2, sort_order: 2 }, { id: 1, sort_order: 1 }];
        sortRows(input);
        expect(input.map(r => r.id)).toEqual([2, 1]);
    });
});

describe('assignMarkers', () => {
    it('assigns * then † to distinct footnotes in row order', () => {
        const list = sortRows([architect(), reviewer, primary]);
        const m = assignMarkers(list);
        expect(m.get(reviewer.footnote)).toBe('*');
        expect(m.get(primary.footnote)).toBe('†');
        expect(m.size).toBe(2);
    });
    it('ignores rows with no footnote', () => {
        expect(assignMarkers([architect()]).size).toBe(0);
    });
});

describe('computeCells — architect (all present)', () => {
    const m = assignMarkers([architect()]);
    const c = computeCells(architect(), m);
    it('formats every numeric cell, no marker, no n/a', () => {
        expect(c.bootMs).toBe('388');
        expect(c.ccBase).toBe('15,401');
        expect(c.ccBaseMarker).toBeNull();
        expect(c.claudeMd).toBe('10,033');
        expect(c.stub).toEqual({ kind: 'value', text: '1,821' });
        expect(c.bootPayload).toBe('4,973');
        expect(c.autoload).toBe('6,768');
        expect(c.docs).toBe('4 / 4');
        expect(c.swc).toBe('38,996');
        expect(c.isPrimary).toBe(false);
    });
});

describe('computeCells — reviewer (bundled stub)', () => {
    const list = sortRows([architect(), reviewer, primary]);
    const m = assignMarkers(list);
    const c = computeCells(reviewer, m);
    it('marks CC base and renders the stub cell as the footnote marker', () => {
        expect(c.ccBase).toBe('6,230');
        expect(c.ccBaseMarker).toBe('*');
        expect(c.stub).toEqual({ kind: 'marker', text: '*' });
        expect(c.docs).toBe('0 / 1');
        expect(c.swc).toBe('19,651');
    });
});

describe('computeCells — primary (no boot/autoload phase)', () => {
    const list = sortRows([architect(), reviewer, primary]);
    const m = assignMarkers(list);
    const c = computeCells(primary, m);
    it('renders n/a for the phases that do not apply, dagger on CC base', () => {
        expect(c.isPrimary).toBe(true);
        expect(c.bootMs).toBe(NA);
        expect(c.ccBase).toBe('24,526');
        expect(c.ccBaseMarker).toBe('†');
        expect(c.stub).toEqual({ kind: 'na', text: NA });
        expect(c.bootPayload).toBe(NA);
        expect(c.autoload).toBe(NA);
        expect(c.docs).toBe(NA);
        expect(c.swc).toBe('34,559');
    });
});
