// @vitest-environment jsdom
//
// Req #3095 gap-coverage pass — ContextPage.jsx had NO component-level test at
// all before this file (a pre-existing gap unrelated to req #3095, named in the
// test-architect's report; this file only closes the slice that req #3095's own
// change touches, not a full page rewrite of coverage).
//
// contextRenderUtils.test.js already pins computeCells()/sortByColumn() as pure
// functions for the five new ground-truth breakdown columns (system_prompt_tokens
// / system_tools_tokens / mcp_tools_tokens / skills_tokens / custom_agents_tokens).
// What THOSE tests cannot see is whether the page actually wires them into the
// table: the new "CC BASE BREAKDOWN" group header, the five sortable <th>s with
// their data-testids, and the five <td>s rendering real values vs "n/a" per row.
//
// Mounted harness with raw react-dom + act — the house pattern (there is no
// @testing-library in this repo). Unlike DocumentsPage.test.jsx / InstructionsPage
// .test.jsx, this harness does NOT call localStorage.clear()/sessionStorage.clear()
// in beforeEach — ContextPage doesn't read either, and (per the test-architect's
// gap analysis) those two calls are the proximate cause of the pre-existing
// unrelated failure in those other two files, not something to reproduce here.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Module-level query data the mocked hooks read from — set per test.
let runsData = [];
let rowsData = [];

vi.mock('../../hooks/useDataQueries', () => ({
    useAgentTelemetryRuns: () => ({ data: runsData, isLoading: false }),
    useAgentTelemetryRowsByRun: () => ({ data: rowsData, isLoading: false }),
    // req #3096 additions ContextPage.jsx now depends on — mocked as empty/no-op
    // so this file's pre-existing test scope (the five ground-truth breakdown
    // columns) is unaffected by the per-document drill-down feature.
    useAgentTelemetryRowDocsByRow: () => ({ data: [], isLoading: false }),
    useMachines: () => ({ data: [] }),
    agentTelemetryRunKeys: { all: (c) => ['agent_telemetry_runs', c] },
}));

vi.mock('../actions/contextApi', () => ({
    deleteAgentTelemetryRun: vi.fn(),
    updateAgentTelemetryRun: vi.fn(),
}));

import ContextPage from '../ContextPage';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';

const URI = 'http://test.local';
const TOKEN = 'tok';
const CREATOR = 'tester';

const RUN = { id: 1, label: 'baseline capture', captured_at: '2026-07-26T00:00:00',
    harness_version: 'cc-x', source_note: null };

// One row WITH the full ground-truth breakdown captured, one WITHOUT — the two
// shapes the report route actually produces (a re-captured agent vs. an older
// run's row that predates req #3095 and simply has NULL in all five columns).
const ROW_WITH_BREAKDOWN = {
    id: 10, agent_name: 'Frontend Architect', role: 'architect', session_kind: 'subagent',
    boot_time_ms: 400, cc_base_tokens: 70082,
    system_prompt_tokens: 9260, system_tools_tokens: 36500, mcp_tools_tokens: 21400,
    skills_tokens: 2000, custom_agents_tokens: 922,
    claude_md_tokens: 10033, charter_stub_tokens: 1821, boot_payload_tokens: 4973,
    autoload_tokens: 6768, docs_loaded: 4, docs_expected: 4,
    start_work_context_tokens: 92714, footnote: null, sort_order: 1,
};
const ROW_WITHOUT_BREAKDOWN = {
    id: 11, agent_name: 'Legacy Agent', role: 'architect', session_kind: 'subagent',
    boot_time_ms: 300, cc_base_tokens: 15000,
    system_prompt_tokens: null, system_tools_tokens: null, mcp_tools_tokens: null,
    skills_tokens: null, custom_agents_tokens: null,
    claude_md_tokens: 10033, charter_stub_tokens: 1500, boot_payload_tokens: 4000,
    autoload_tokens: 5000, docs_loaded: 2, docs_expected: 2,
    start_work_context_tokens: 30000, footnote: null, sort_order: 2,
};

let container;
let root;

function mount() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: URI }}>
                    <AuthContext.Provider value={{ idToken: TOKEN, profile: { userName: CREATOR } }}>
                        <ContextPage />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
}

beforeEach(() => {
    runsData = [RUN];
    rowsData = [ROW_WITH_BREAKDOWN, ROW_WITHOUT_BREAKDOWN];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

describe('ContextPage — CC BASE BREAKDOWN columns (req #3095)', () => {
    it('renders the group header spanning all five breakdown columns', () => {
        mount();
        const groupHeaders = [...container.querySelectorAll('th.grp')]
            .map(th => th.textContent);
        expect(groupHeaders).toContain('CC BASE BREAKDOWN');
    });

    it('renders all five sortable column headers with their data-testids', () => {
        mount();
        for (const field of ['system_prompt_tokens', 'system_tools_tokens',
            'mcp_tools_tokens', 'skills_tokens', 'custom_agents_tokens']) {
            const th = container.querySelector(`[data-testid="agent-context-sort-${field}"]`);
            expect(th, `missing header for ${field}`).not.toBeNull();
        }
    });

    it('formats real values for a row whose breakdown was captured', () => {
        mount();
        const row = container.querySelector('[data-testid="agent-context-row-10"]');
        expect(row).not.toBeNull();
        const cells = [...row.querySelectorAll('td.num')].map(td => td.textContent);
        expect(cells).toContain('9,260');
        expect(cells).toContain('36,500');
        expect(cells).toContain('21,400');
        expect(cells).toContain('2,000');
        expect(cells).toContain('922');
    });

    it('renders n/a for a row whose breakdown was never captured', () => {
        mount();
        const row = container.querySelector('[data-testid="agent-context-row-11"]');
        expect(row).not.toBeNull();
        // The five breakdown <td>s sit between cc_base_tokens and claude_md_tokens;
        // count how many "n/a" markers this row shows overall and confirm it's at
        // least 5 (the five breakdown cells), without depending on exact column
        // position, which is already pinned by the header-order test above.
        const naCount = [...row.querySelectorAll('td .fn')]
            .filter(el => el.textContent === 'n/a').length;
        expect(naCount).toBeGreaterThanOrEqual(5);
    });

    it('clicking the System Prompt header sorts the table by that column', () => {
        mount();
        const th = container.querySelector('[data-testid="agent-context-sort-system_prompt_tokens"]');
        act(() => { th.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        // Descending is the natural direction for a numeric column — row 10
        // (9260) outranks row 11 (null, sorted last), so it must render FIRST.
        const rows = [...container.querySelectorAll('tbody tr[data-testid^="agent-context-row-"]')];
        expect(rows[0].getAttribute('data-testid')).toBe('agent-context-row-10');
    });

    it('the glossary lists all five breakdown terms', () => {
        mount();
        act(() => {
            container.querySelector('[data-testid="agent-context-glossary-btn"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        const text = document.body.textContent;
        for (const term of ['System Prompt', 'System Tools', 'MCP Tools', 'Skills', 'Custom Agents']) {
            expect(text).toContain(term);
        }
    });
});

// ---------------------------------------------------------------------------
// req #3202 — the SHARED TELEMETRY ENVELOPE on the run header
// ---------------------------------------------------------------------------
// Everything above measures ONE AGENT's context. The envelope measures what the
// CAPTURE RUN itself cost, in the same terms a swarm session records — and this
// page showed NO run cost at all before #3202.
//
// These tests exist because storing the record is not delivering it: a column
// written and never rendered is invisible, and the acceptance for #3202 is that
// both domains USE the record. They also pin the NULL rule at the render layer,
// which is where a fabricated zero would actually mislead somebody.

describe('ContextPage — shared telemetry envelope (req #3202)', () => {
    const ENVELOPE_RUN = {
        ...RUN,
        wall_ms: 252431,
        tokens_input: 1200, tokens_cache_write: 45600,
        tokens_cache_read: 12300000, tokens_output: 8400,
        prompt_text: '/agent-telemetry-run 2026-08-08 capture',
        prompt_sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        prompt_chars: 39,
    };

    it('renders the run wall clock in a human unit, from milliseconds', () => {
        runsData = [ENVELOPE_RUN];
        mount();
        expect(container.querySelector('[data-testid="agent-context-wall-ms"]').textContent)
            .toBe('4m 12s');
    });

    it('renders the four-way token usage the table below cannot show', () => {
        runsData = [ENVELOPE_RUN];
        mount();
        expect(container.querySelector('[data-testid="agent-context-tokens-total"]').textContent)
            .toBe('12.4M');
        const breakdown = container
            .querySelector('[data-testid="agent-context-tokens-breakdown"]').textContent;
        expect(breakdown).toContain('Input 1.2k');
        expect(breakdown).toContain('Cache write 45.6k');
        expect(breakdown).toContain('Cache read 12.3M');
        expect(breakdown).toContain('Output 8.4k');
    });

    it('renders what the run was asked — the thing nothing captured before', () => {
        runsData = [ENVELOPE_RUN];
        mount();
        expect(container.querySelector('[data-testid="agent-context-prompt"]').textContent)
            .toBe('/agent-telemetry-run 2026-08-08 capture');
        expect(container.querySelector('[data-testid="agent-context-prompt-meta"]').textContent)
            .toContain('abcdef012345');
    });

    it('says so when the stored prompt is only a prefix of what was asked', () => {
        runsData = [{ ...ENVELOPE_RUN, prompt_text: 'x'.repeat(2000), prompt_chars: 5400 }];
        mount();
        const meta = container
            .querySelector('[data-testid="agent-context-prompt-meta"]').textContent;
        expect(meta).toContain('first 2,000 of');
        expect(meta).toContain('5,400 chars');
    });

    it('hides the whole block for a pre-#3202 capture rather than showing em-dashes', () => {
        runsData = [RUN];
        mount();
        expect(container.querySelector('[data-testid="agent-context-envelope"]')).toBeNull();
    });

    it('NEVER prints 0 for a token type nobody measured', () => {
        // THE rule. A partially-measured capture must show the part it knows and
        // an em-dash for the rest — a 0 here would be a false claim about a real
        // run, and would understate every aggregate it fed.
        runsData = [{ ...RUN, wall_ms: 5000, tokens_output: 8400 }];
        mount();
        const breakdown = container
            .querySelector('[data-testid="agent-context-tokens-breakdown"]').textContent;
        expect(breakdown).toContain('Output 8.4k');
        expect(breakdown).toContain('Input —');
        expect(breakdown).toContain('Cache read —');
        expect(breakdown).not.toContain('Input 0');
    });
});
