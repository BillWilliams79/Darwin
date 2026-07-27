// Req #3031 — the artifact-faithful cell decisions for /agents/context.
// Uses the seeded 2026-07-22 baseline rows as the fixture so the test doubles as
// a regression guard against the published visual-acceptance spec.

import { describe, it, expect } from 'vitest';
import {
    fmt, NA, sortByColumn, naturalSortDir, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR,
    assignMarkers, computeCells,
} from '../contextRenderUtils';

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

describe('sortByColumn', () => {
    it('defaults to agent name ascending, with PrimaryAI pinned first', () => {
        const out = sortByColumn(
            [primary, reviewer, architect()], DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR);
        expect(out.map(r => r.agent_name)).toEqual(['Darwin PrimaryAI', 'AWS', 'Code Reviewer']);
    });
    it('pins PrimaryAI first ascending and last descending — reversing with direction', () => {
        const asc = sortByColumn([architect(), reviewer, primary], 'agent_name', 'asc');
        const desc = sortByColumn([architect(), reviewer, primary], 'agent_name', 'desc');
        expect(asc.map(r => r.agent_name)).toEqual(['Darwin PrimaryAI', 'AWS', 'Code Reviewer']);
        expect(desc.map(r => r.agent_name)).toEqual(['Code Reviewer', 'AWS', 'Darwin PrimaryAI']);
    });
    it('sorts non-pinned rows alphabetically, not by input order', () => {
        // Input order is Code Reviewer, then PrimaryAI, then AWS — the opposite of
        // both the pin and the alphabet, so a comparator bug that just preserved
        // input order for non-pinned rows would produce the wrong result here.
        const out = sortByColumn([reviewer, primary, architect()], 'agent_name', 'asc');
        expect(out.map(r => r.agent_name)).toEqual(['Darwin PrimaryAI', 'AWS', 'Code Reviewer']);
    });
    it('sorts a numeric column ascending', () => {
        const out = sortByColumn(
            [architect(), reviewer, primary], 'boot_time_ms', 'asc');
        expect(out.map(r => r.id)).toEqual([12, 1, 13]); // 358, 388, null
    });
    it('flips to descending on the same column', () => {
        const out = sortByColumn(
            [architect(), reviewer, primary], 'boot_time_ms', 'desc');
        expect(out.map(r => r.id)).toEqual([1, 12, 13]); // 388, 358, null-still-last
    });
    it('keeps NULLs last in both directions', () => {
        const asc = sortByColumn([architect(), primary], 'boot_time_ms', 'asc');
        const desc = sortByColumn([architect(), primary], 'boot_time_ms', 'desc');
        expect(asc.map(r => r.id)).toEqual([1, 13]);
        expect(desc.map(r => r.id)).toEqual([1, 13]);
    });
    it('breaks ties by id, direction-independent', () => {
        const rows = [{ id: 2, boot_time_ms: 5 }, { id: 1, boot_time_ms: 5 }];
        expect(sortByColumn(rows, 'boot_time_ms', 'asc').map(r => r.id)).toEqual([1, 2]);
        expect(sortByColumn(rows, 'boot_time_ms', 'desc').map(r => r.id)).toEqual([1, 2]);
    });
    it('does not mutate input', () => {
        const input = [{ id: 2, agent_name: 'B' }, { id: 1, agent_name: 'A' }];
        sortByColumn(input, 'agent_name', 'desc');
        expect(input.map(r => r.id)).toEqual([2, 1]);
    });
    it('falls back to the default column (agent name, pin included) for an unknown field', () => {
        const out = sortByColumn([architect(), primary], 'not_a_real_column', 'asc');
        expect(out.map(r => r.agent_name)).toEqual(['Darwin PrimaryAI', 'AWS']);
    });
});

describe('naturalSortDir', () => {
    it('defaults a numeric column to descending', () => {
        expect(naturalSortDir('boot_time_ms')).toBe('desc');
        expect(naturalSortDir('start_work_context_tokens')).toBe('desc');
    });
    it('defaults the string column to ascending', () => {
        expect(naturalSortDir('agent_name')).toBe('asc');
    });
    it('falls back to the default column for an unknown field', () => {
        expect(naturalSortDir('not_a_real_column')).toBe(naturalSortDir(DEFAULT_SORT_FIELD));
    });
});

describe('assignMarkers', () => {
    it('assigns * then † to distinct footnotes in row order', () => {
        // Row order is now PrimaryAI (pinned first), architect, reviewer — see
        // the sortByColumn describe block — so PrimaryAI's footnote is the
        // first DISTINCT one encountered and gets '*'; reviewer's is second.
        const list = sortByColumn([architect(), reviewer, primary], DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR);
        const m = assignMarkers(list);
        expect(m.get(primary.footnote)).toBe('*');
        expect(m.get(reviewer.footnote)).toBe('†');
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
        expect(c.docsIncomplete).toBe(false);
        expect(c.docsClickable).toBe(true);
        expect(c.swc).toBe('38,996');
        expect(c.isPrimary).toBe(false);
    });
});

describe('computeCells — reviewer (bundled stub)', () => {
    const list = sortByColumn([architect(), reviewer, primary], DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR);
    const m = assignMarkers(list);
    const c = computeCells(reviewer, m);
    it('marks CC base and renders the stub cell as the footnote marker', () => {
        expect(c.ccBase).toBe('6,230');
        expect(c.ccBaseMarker).toBe('†');
        expect(c.stub).toEqual({ kind: 'marker', text: '†' });
        expect(c.docs).toBe('0 / 1');
        expect(c.docsIncomplete).toBe(true);
        expect(c.docsClickable).toBe(false);
        expect(c.swc).toBe('19,651');
    });
});

describe('computeCells — primary (no boot/autoload phase)', () => {
    const list = sortByColumn([architect(), reviewer, primary], DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR);
    const m = assignMarkers(list);
    const c = computeCells(primary, m);
    it('renders n/a for the phases that do not apply, star on CC base', () => {
        expect(c.isPrimary).toBe(true);
        expect(c.bootMs).toBe(NA);
        expect(c.ccBase).toBe('24,526');
        expect(c.ccBaseMarker).toBe('*');
        expect(c.stub).toEqual({ kind: 'na', text: NA });
        expect(c.bootPayload).toBe(NA);
        expect(c.autoload).toBe(NA);
        expect(c.docs).toBe(NA);
        expect(c.docsIncomplete).toBe(false);
        expect(c.docsClickable).toBe(false);
        expect(c.swc).toBe('34,559');
    });
});

describe('naturalSortDir — ground-truth breakdown columns (req #3095)', () => {
    it('defaults each breakdown column to descending, same as any other numeric column', () => {
        expect(naturalSortDir('system_prompt_tokens')).toBe('desc');
        expect(naturalSortDir('system_tools_tokens')).toBe('desc');
        expect(naturalSortDir('mcp_tools_tokens')).toBe('desc');
        expect(naturalSortDir('skills_tokens')).toBe('desc');
        expect(naturalSortDir('custom_agents_tokens')).toBe('desc');
    });
});

describe('sortByColumn — ground-truth breakdown columns (req #3095)', () => {
    it('sorts by system_tools_tokens, NULLs last', () => {
        const rows = [
            architect({ id: 1, system_tools_tokens: 36500 }),
            architect({ id: 2, system_tools_tokens: null }),
            architect({ id: 3, system_tools_tokens: 12000 }),
        ];
        expect(sortByColumn(rows, 'system_tools_tokens', 'desc').map(r => r.id))
            .toEqual([1, 3, 2]);
    });
});

describe('computeCells — ground-truth breakdown (req #3095)', () => {
    it('formats all five breakdown cells when present', () => {
        const row = architect({
            system_prompt_tokens: 926, system_tools_tokens: 36500,
            mcp_tools_tokens: 21400, skills_tokens: 2000, custom_agents_tokens: 922,
        });
        const c = computeCells(row, new Map());
        expect(c.systemPrompt).toBe('926');
        expect(c.systemTools).toBe('36,500');
        expect(c.mcpTools).toBe('21,400');
        expect(c.skills).toBe('2,000');
        expect(c.customAgents).toBe('922');
    });
    it('renders n/a for a row whose breakdown was never captured', () => {
        // architect() fixture doesn't set the five breakdown fields at all —
        // the same "not yet measured" shape as an existing historical run row.
        const c = computeCells(architect(), new Map());
        expect(c.systemPrompt).toBe(NA);
        expect(c.systemTools).toBe(NA);
        expect(c.mcpTools).toBe(NA);
        expect(c.skills).toBe(NA);
        expect(c.customAgents).toBe(NA);
    });
});

describe('computeCells — docsIncomplete edge cases', () => {
    const m = new Map();
    it('0/0 is not incomplete — nothing was owed', () => {
        const c = computeCells(architect({ docs_loaded: 0, docs_expected: 0 }), m);
        expect(c.docs).toBe('0 / 0');
        expect(c.docsIncomplete).toBe(false);
    });
    it('a null docs_loaded with a known docs_expected renders n/a, not incomplete', () => {
        const c = computeCells(architect({ docs_loaded: null, docs_expected: 5 }), m);
        expect(c.docs).toBe(NA);
        expect(c.docsIncomplete).toBe(false);
    });
    it('a known docs_loaded with a null docs_expected renders n/a, not incomplete', () => {
        const c = computeCells(architect({ docs_loaded: 3, docs_expected: null }), m);
        expect(c.docs).toBe(NA);
        expect(c.docsIncomplete).toBe(false);
    });
});

describe('computeCells — docsClickable edge cases (req #3096)', () => {
    const m = new Map();
    it('0 docs_loaded is inert — nothing to drill into', () => {
        const c = computeCells(architect({ docs_loaded: 0, docs_expected: 0 }), m);
        expect(c.docsClickable).toBe(false);
    });
    it('null docs_loaded (n/a, e.g. PrimaryAI) is inert', () => {
        const c = computeCells(architect({ docs_loaded: null, docs_expected: null }), m);
        expect(c.docsClickable).toBe(false);
    });
    it('at least one doc loaded is clickable, even if incomplete vs. expected', () => {
        const c = computeCells(architect({ docs_loaded: 1, docs_expected: 4 }), m);
        expect(c.docsIncomplete).toBe(true);
        expect(c.docsClickable).toBe(true);
    });
});
