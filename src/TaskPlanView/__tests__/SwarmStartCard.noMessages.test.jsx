// @vitest-environment jsdom
//
// Req #3286 — THE AGGREGATOR CARD RENDERS NO MESSAGES, IN ANY STATE.
//
// This is the requirement's acceptance criterion made mechanical. A
// string-absence assertion would not do: this card's pipelined note was already
// deleted once (req #3248, Darwin PR #911) and restored by the req #3242/#3258
// merge, so the guard has to catch the NEXT sentence, not the last one. It
// ENUMERATES what the real card puts on screen and requires each item to be a
// control label or a datum:
//
//   • one of the five chip labels
//   • a badge count — `\d+`, or MUI's `99+` overflow form (Badge's `max`
//     defaults to 99, and the Met chip's count runs to four digits on live data)
//   • a row's own title, in the title editor
//
// Anything else — an empty state, a filter explanation, a hint — fails. Prose
// is swept for in every place a READER could see it: text nodes, the two
// attributes that render text without one (`placeholder`, `title`), and
// form-control values. `aria-label` is NOT swept — see the note on
// `cardAttributeText` for why that is the right line.
//
// KNOWN LIMIT, deliberate: the sort Menu, the row Tooltips, RequirementDeleteDialog
// and `showError` snackbars all render into portals on `document.body`, outside
// the card subtree walked here. The requirement keeps all four, so this proves
// "no message in the card's own DOM" — not "no text anywhere near the card".
//
// States exercised: every one of the five chips, each with rows and with none,
// plus the fully-orchestration-hidden state (Swarm-Ready with the toggle ON and
// every row plan-carried) which is what the removed note described, the
// four-digit Met count, and first paint before any query resolves.
//
// req #3502 — those hidden states are now produced by the TOGGLE rather than by
// the aggregator's own launch exclusion, which is deleted. The states themselves
// are unchanged and still reachable, so this file keeps testing them; only how
// the fixture arrives at them moved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

// Query doubles. `undefined` is a real state here (first paint / in-flight),
// distinct from `[]` (resolved and empty) — the card renders a spinner for the
// former and a body for the latter, and both must be message-free.
let activeRows;
let metRows;
let allRows;
let pipelinedIds;
// req #3419 — the junction rows the REAL `useRequirementVisibility` reads. The
// tests still express intent as a Set of ids; this is the wire shape.
let junctionRows = [];
const setPipelined = (ids) => {
    pipelinedIds = ids;
    junctionRows = [...ids].map((id) => ({ step_fk: 1, requirement_fk: id }));
};
const EMPTY = [];
vi.mock('../../hooks/useDataQueries', () => ({
    useRequirementsByStatus: () => ({ data: activeRows }),
    useRequirementsDone: () => ({ data: metRows }),
    useSessions: () => ({ data: EMPTY }),
    useCategoryColors: () => ({ data: EMPTY }),
    useAllRequirements: () => ({ data: allRows }),

    // req #3419 — the three bounded reads `useRequirementVisibility` joins.
    // The REAL hook runs here rather than a double: it owns the memoization the
    // aggregator's `useMemo` chain depends on, and a stand-in that got that
    // wrong would loop rather than fail. `ALL_ROWS` is re-exported because the
    // hook passes it (a closed feature still seats its requirements).
    useAllPipelineStepRequirements: () => ({ data: junctionRows }),
    ALL_ROWS: 'all',
}));

vi.mock('../../RestApi/RestApi', () => ({
    default: vi.fn(() => Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] })),
}));

import SwarmStartCard from '../SwarmStartCard';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';
import { useSwarmStartCardStore } from '../../stores/useSwarmStartCardStore';
import { useShowClosedStore } from '../../stores/useShowClosedStore';
import { requirementStatusLabel } from '../../SwarmView/statusChipStyles';

const STATUSES = ['authoring', 'approved', 'swarm_ready', 'development', 'met'];
const CHIP_LABELS = new Set(STATUSES.map(requirementStatusLabel));

let roots = [];
function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    roots.push(root);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                            <SwarmStartCard />
                        </DndProvider>
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    return { container };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

// Every non-blank text node inside the card, in document order.
//
// Zero-width characters are stripped before the blank check: MUI's outlined
// TextField puts a U+200B in the notched-outline legend of every row's title
// editor, which is layout scaffolding rather than anything a reader can see.
// Only invisible characters are stripped — no real copy can hide behind this.
const stripInvisible = (s) => s.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

// Text inside a form control is the row's TITLE — the requirement's own data,
// typed by the user, not copy the card authored. (React seeds the multiline
// title editor's <textarea> with a text child.) It is NOT skipped: it is checked
// against the fixture's titles below, so a sentence cannot be smuggled in as a
// control's value either.
const isFormControlValue = (node) =>
    Boolean(node.parentElement && node.parentElement.closest('textarea, input'));

function cardEl(container) {
    const card = container.querySelector('[data-testid="swarm-start-card"]');
    expect(card, 'the card itself must render').not.toBeNull();
    return card;
}

function cardTextNodes(card) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const out = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (isFormControlValue(n)) continue;
        const text = stripInvisible(n.textContent || '');
        if (text) out.push(text);
    }
    return out;
}

// Text a reader sees WITHOUT a text node: `placeholder` renders in an empty
// field, `title` renders as a native tooltip, and a control's `value` is the
// field's contents. A message hidden in any of the three would sail past a
// text-node-only walker, so they are swept with the same allowlist.
//
// `aria-label` is deliberately NOT swept: it is not visible, and on this card it
// carries the accessible NAME of icon-only controls (`Open requirement 42`) —
// the same category as the row Tooltips the requirement explicitly keeps.
function cardAttributeText(card) {
    const out = [];
    for (const el of card.querySelectorAll('[placeholder], [title]')) {
        for (const attr of ['placeholder', 'title']) {
            const v = stripInvisible(el.getAttribute(attr) || '');
            if (v) out.push(v);
        }
    }
    for (const el of card.querySelectorAll('textarea, input')) {
        // MUI's TextareaAutosize renders a SECOND, off-screen textarea purely to
        // measure height, seeded with `value || placeholder || 'x'`. The literal
        // 'x' (TextareaAutosize.js:105) is measurement scaffolding, not copy, and
        // is the ONLY thing skipped here.
        //
        // The skip is keyed on that sentinel VALUE, not on the shadow's markers.
        // Excluding every `aria-hidden` control — even requiring all three markers
        // (`aria-hidden` + `readOnly` + `tabIndex=-1`, TextareaAutosize.js:213-224)
        // — leaves a real hole: a hand-written `<textarea aria-hidden readOnly
        // tabIndex={-1} value="No swarm-ready requirements">` carries all three and
        // would sail through. Measured: it did. Keying on 'x' closes that, and
        // nothing legitimate is lost — when the shadow mirrors a real value it
        // mirrors a row title, which the allowlist accepts anyway, and when it
        // mirrors a placeholder the visible field's own attribute is swept above.
        const isAutosizeShadow = el.getAttribute('aria-hidden') === 'true'
            && el.readOnly && el.tabIndex === -1 && el.value === 'x';
        if (isAutosizeShadow) continue;
        const v = stripInvisible(el.value || '');
        if (v) out.push(v);
    }
    return out;
}

// What the card is allowed to show: a chip label, a badge count, or a row title.
//
// The badge count accepts MUI's overflow form too. `Badge`'s `max` defaults to
// 99, and `counts.met` is the whole Met population (1041 rows on live data as of
// 2026-08-02) until the trailing-24h query overlays it — so `99+` is a REAL
// rendering of a legitimate datum, in exactly the in-flight/failed-fetch state
// this file exercises. A bare `\d+` predicate would fail on it and invite the
// next reader to loosen the rule.
const isControlOrDatum = (text, titles) =>
    CHIP_LABELS.has(text) || /^\d+\+?$/.test(text) || titles.has(text);

function expectNoMessages(container, label) {
    // Row titles come from the fixture the test itself seeded — allowlisted by
    // exact value, never by shape, so "No authoring requirements" can't match.
    const titles = new Set(
        [...(Array.isArray(activeRows) ? activeRows : []),
         ...(Array.isArray(metRows) ? metRows : [])]
            .map(r => r.title).filter(Boolean));
    const card = cardEl(container);
    const seen = [...cardTextNodes(card), ...cardAttributeText(card)];
    const offenders = seen.filter(t => !isControlOrDatum(t, titles));
    expect(offenders, `${label} — the aggregator card must render no message text`).toEqual([]);
}

const req = (id, status, overrides = {}) => ({
    id,
    title: `Requirement ${id}`,
    requirement_status: status,
    coordination_type: 'implemented',
    ai_model: 'opus',
    effort: 'high',
    category_fk: 5,
    ...overrides,
});

describe('SwarmStartCard renders no messages (req #3286)', () => {
    beforeEach(() => {
        roots = [];
        activeRows = EMPTY;
        metRows = EMPTY;
        allRows = EMPTY;
        setPipelined(new Set());
        useShowClosedStore.setState({ hidePipelinedRequirements: false });
    });
    afterEach(() => {
        act(() => { roots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('renders no text while the queries are still in flight (first paint)', async () => {
        activeRows = undefined;
        metRows = undefined;
        allRows = undefined;
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
        const { container } = mount();
        await flush();
        // The spinner is a control-state indicator and carries no text; it is
        // explicitly kept by the requirement.
        expect(container.querySelector('.MuiCircularProgress-root')).not.toBeNull();
        expectNoMessages(container, 'first paint');
    });

    // The acceptance criterion: click every chip, including ones with no rows.
    for (const status of STATUSES) {
        it(`renders no text on the ${status} chip with rows`, async () => {
            const rows = [req(10, status), req(11, status)];
            activeRows = rows;
            metRows = status === 'met' ? rows : EMPTY;
            allRows = rows;
            useSwarmStartCardStore.setState({ selectedStatus: status });
            const { container } = mount();
            await flush();
            expect(container.querySelectorAll('[data-testid^="requirement-"]').length)
                .toBeGreaterThan(0);
            // The rows still show their data — the walker skips form-control
            // values, so prove here that the titles are actually on screen and
            // the exclusion above isn't hiding the card's real content.
            const titles = [...container.querySelectorAll('[data-testid^="requirement-"] textarea')]
                .map(t => t.value);
            expect(titles).toContain('Requirement 10');
            expectNoMessages(container, `${status} chip, populated`);
        });

        it(`renders no text on the empty ${status} chip`, async () => {
            useSwarmStartCardStore.setState({ selectedStatus: status });
            const { container } = mount();
            await flush();
            // Empty body === the template row alone, and nothing else.
            expect(container.querySelector('[data-testid="requirement-template"]')).not.toBeNull();
            expect(container.querySelectorAll('[data-testid^="requirement-"]').length).toBe(1);
            expectNoMessages(container, `${status} chip, empty`);
        });
    }

    // The state the removed req #3180 note described: every row on a launch chip
    // gone because a pipeline step carries it. Since req #3502 the TOGGLE is
    // what produces it (the card's own unconditional exclusion is deleted), so
    // the fixture turns the toggle on. The state still happens — it is simply
    // not narrated.
    it('renders no text when the orchestrated toggle empties a launch chip', async () => {
        const rows = [req(10, 'swarm_ready'), req(11, 'swarm_ready')];
        activeRows = rows;
        allRows = rows;
        setPipelined(new Set([10, 11]));
        useShowClosedStore.setState({ hidePipelinedRequirements: true });
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
        const { container } = mount();
        await flush();
        // Behaviour intact: both rows excluded, badge agrees with the list.
        // Read the badge BUBBLE, not the Badge root — the testid lands on the
        // root, whose textContent is the chip label plus the count, so a
        // substring check there would pass on the wrong number.
        expect(container.querySelectorAll('[data-testid^="requirement-"]').length).toBe(1);
        const bubble = container.querySelector(
            '[data-testid="swarm-start-chip-badge-swarm_ready"] .MuiBadge-badge');
        expect(bubble.textContent).toBe('0');
        expect(bubble.className).toContain('MuiBadge-invisible');
        expectNoMessages(container, 'launch chip fully hidden');
    });

    it('renders no text when the toggle hides only some rows', async () => {
        const rows = [req(10, 'swarm_ready'), req(11, 'swarm_ready'), req(12, 'swarm_ready')];
        activeRows = rows;
        allRows = rows;
        setPipelined(new Set([11]));
        useShowClosedStore.setState({ hidePipelinedRequirements: true });
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
        const { container } = mount();
        await flush();
        expect(container.querySelector('[data-testid="requirement-11"]')).toBeNull();
        expect(container.querySelector('[data-testid="requirement-10"]')).not.toBeNull();
        expectNoMessages(container, 'launch chip partly hidden');
    });

    // The live Met population is four digits (1041 rows, 2026-08-02), and
    // `counts.met` carries all of it until the trailing-24h query overlays it.
    // MUI clamps the badge to `99+` — a datum, and the state a naive `^\d+$`
    // allowlist would have called a message.
    it('renders no text when the Met badge overflows to 99+', async () => {
        allRows = Array.from({ length: 120 }, (_, i) => req(1000 + i, 'met'));
        activeRows = EMPTY;
        metRows = undefined; // trailing-24h query not resolved → no overlay
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
        const { container } = mount();
        await flush();
        const bubble = container.querySelector(
            '[data-testid="swarm-start-chip-badge-met"] .MuiBadge-badge');
        expect(bubble.textContent).toBe('99+');
        expectNoMessages(container, 'Met badge overflow');
    });

    it('renders no text on the Met chip when the trailing-24h window is empty', async () => {
        allRows = [req(10, 'development')];
        activeRows = EMPTY;
        metRows = EMPTY;
        useSwarmStartCardStore.setState({ selectedStatus: 'met' });
        const { container } = mount();
        await flush();
        expectNoMessages(container, 'empty Met window');
    });

    it('renders no text when the global hide-pipelined toggle empties an observation chip', async () => {
        const rows = [req(10, 'development'), req(11, 'development')];
        activeRows = rows;
        allRows = rows;
        setPipelined(new Set([10, 11]));
        useShowClosedStore.setState({ hidePipelinedRequirements: true });
        useSwarmStartCardStore.setState({ selectedStatus: 'development' });
        const { container } = mount();
        await flush();
        expect(container.querySelectorAll('[data-testid^="requirement-"]').length).toBe(1);
        expectNoMessages(container, 'development chip hidden by toggle');
    });

    it('renders no text when a failed fetch leaves the card without data', async () => {
        // A rejected query surfaces as `data: undefined`, identical to first paint —
        // the card must not grow an error sentence in that state.
        activeRows = undefined;
        metRows = undefined;
        allRows = undefined;
        useSwarmStartCardStore.setState({ selectedStatus: 'approved' });
        const { container } = mount();
        await flush();
        expectNoMessages(container, 'failed fetch');
    });

    it('keeps every chip control while rendering no message text', async () => {
        useSwarmStartCardStore.setState({ selectedStatus: 'swarm_ready' });
        const { container } = mount();
        await flush();
        for (const status of STATUSES) {
            expect(container.querySelector(`[data-testid="swarm-start-chip-${status}"]`),
                `${status} chip must survive`).not.toBeNull();
        }
        expect(container.querySelector('[data-testid="swarm-start-card-menu"]')).not.toBeNull();
        expectNoMessages(container, 'controls intact');
    });
});
