// @vitest-environment jsdom
//
// Req #3435 — the Orchestration box on the requirement detail page.
// Three rows — Pipeline, Initiative, Epic — top to bottom, each with a button that
// opens the visualizer AT THAT LEVEL and a select beside it. Since req #3579 the
// box is a CASCADE: Pipeline is live from the start, Initiative and Epic enable once a
// plan is chosen, an initiative narrows the Epic list to its own epics, and only EPIC
// writes (plus "No pipeline" on a seated requirement, which unseats it).
//
// RE-BASED ON PIPELINE 2.0 BY REQ #3356, and two things about this fixture moved
// as a direct consequence:
//   - a 2.0 epic carries `initiative_fk`, NOT `pipeline_fk`, so the plan is reached in
//     two hops and there is an INITIATIVES fixture between the epics and the plans;
//   - `epic_requirements` has `PRIMARY KEY (requirement_fk)` alone
//     (one epic per requirement, the req #3336 stage-2 gate ruling), so a MOVE
//     is DELETE-then-POST. Insert-first cannot succeed while the old row exists,
//     which is why the order assertion below is inverted from its 1.0 form and
//     why the failure case is now a failed DELETE rather than a failed POST.
//
// The assertions that matter are the ones a regression would make invisible:
//   - picking an epic WRITES `epic_requirements` — the junction that
//     actually places a requirement on a plan, and the one EpicsPage refuses to
//     touch. A write to the wrong table or in the wrong order looks identical
//     from the UI until the plan view disagrees;
//   - the epic list is scoped to THIS plan;
//   - the EPIC row reads "No epic" when nothing seats the requirement, which is
//     how seated-vs-unseated stays legible — that is the distinction the sync
//     report splits into UNSEATED-REQS and ORPHANS, and it decides whether a
//     launch is the coordinator's to make;
//   - each button lands at ITS OWN level (plan / bead), not both at the plan;
//   - the box carries no `via feature "…"` caption — a regression here would
//     mean the retired concept quietly came back;
//   - the cascade (req #3579): nothing below Pipeline is pickable without a
//     plan, and a plan or initiative that does not hold the seat never shows the old
//     epic under it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `RouterLink` is what the two icon buttons render as, so the mock has to supply
// a real anchor — an undefined `Link` would make the buttons throw at render and
// the failure would look like a data problem. `vi.mock` factories are HOISTED
// above the imports, so the module-scope `React` binding is not initialised when
// this runs: the factory imports react itself and uses `createElement`.
// MUTABLE so a case can navigate to another requirement (Up/Down).
let routeId = '3435';
vi.mock('react-router-dom', async () => {
    const react = await import('react');
    return {
        useParams: () => ({ id: routeId }),
        useNavigate: () => () => {},
        useLocation: () => ({ state: {} }),
        Link: react.forwardRef(({ to, children, ...rest }, ref) =>
            react.createElement('a', { href: to, ref, ...rest }, children)),
    };
});

const PIPELINES = [
    { id: 2,  title: 'Darwin',        pipeline_status: 'active', create_ts: '2026-07-28T05:17:51' },
    { id: 79, title: 'Agent Harness', pipeline_status: 'active', create_ts: '2026-08-07T08:54:36' },
    { id: 80, title: 'Old Plan',      pipeline_status: 'completed' },   // never offered
];
// The MIDDLE HOP a 2.0 epic's plan is reached through (req #3356), and since
// req #3579 a select of its own.
const INITIATIVES = [
    { id: 20, pipeline_fk: 2,  title: 'Orchestration UI', sort_order: 2 },
    { id: 21, pipeline_fk: 2,  title: 'Polish',           sort_order: 1 },
    { id: 22, pipeline_fk: 2,  title: 'Retired',          sort_order: 0, closed: 1 },
    { id: 90, pipeline_fk: 79, title: 'Agent',            sort_order: 1 },
    { id: 91, pipeline_fk: 79, title: 'Agent Spare',      sort_order: 2 },   // no epics
    { id: 80, pipeline_fk: 80, title: 'Old Initiative',         sort_order: 1 },
];
const EPICS = [
    { id: 100, initiative_fk: 20, title: 'Orchestration Box' },
    { id: 104, initiative_fk: 20, title: 'Polish Round 2' },
    { id: 105, initiative_fk: 20, title: 'Polish Shipped' },   // its work all met
    { id: 101, initiative_fk: 20, title: 'Plan Layer' },
    { id: 200, initiative_fk: 90, title: 'Agent Boot' },
    { id: 300, initiative_fk: 20 },   // no title, no reqs
    { id: 106, initiative_fk: 21, title: 'Polish Tail' },
    { id: 801, initiative_fk: 80, title: 'Old Epic' },
];
// MUTABLE: some cases need a requirement seated on NO epic.
let epicRequirements = [];
const DEFAULT_EPIC_REQUIREMENTS = [
    { epic_fk: 100, requirement_fk: 3435 },  // this requirement -> plan 2
    { epic_fk: 104, requirement_fk: 3437 },
    { epic_fk: 105, requirement_fk: 3438 },  // met — the epic still takes work
    { epic_fk: 101, requirement_fk: 3401 },
    { epic_fk: 200, requirement_fk: 3400 },  // plan 79
];

let queryErrors = {};
const q = (name, data) => ({
    data,
    isLoading: false,
    isError: !!queryErrors[name],
    isPending: false,
    isSuccess: !queryErrors[name],
});

vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useMachines: () => q('machines', []),
        useAllCategories: () => q('categories', [{ id: 1, category_name: 'Swarm' }]),
        useAllPipelines: () => q('pipelines', PIPELINES),
        useAllInitiatives: () => q('initiatives', INITIATIVES),
        useAllPipelineEpics: () => q('epics', EPICS),
        useAllPipelineEpicRequirements: () => q('links', epicRequirements),
    };
});

let requirementRow;
// A FLAG, not `mockImplementationOnce`. The page PUTs for its own reasons (a
// description blur fires one whenever focus leaves the field, which opening a
// menu does), so a one-shot override is consumed by whichever write happens to
// go first — and the test would then assert a rollback that never ran.
//
// It REJECTS, because `call_rest_api` THROWS `{data, httpStatus}` on any non-2xx
// (RestApi.jsx). A mock that resolved a 500 would leave the real failure path
// untested and hide a `.catch(() => null)` that strips the status code.
let putStatus = 200;
const putBodies = [];
// Every `epic_requirements` write, in order — the seat is a junction
// row, not a column, so DELETE/POST ORDER is the thing under test.
const seatCalls = [];
let seatStatus = { POST: 200, DELETE: 200 };
// When set, every seat write waits on it — the in-flight window.
let seatGate = null;
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn(async (uri, method, body) => {
        if (uri.includes('/epic_requirements') && method !== 'GET') {
            seatCalls.push({ method, body });
            if (seatGate) await seatGate;
            const st = seatStatus[method] ?? 200;
            if (!(st >= 200 && st < 300)) {
                throw { httpStatus: { httpStatus: st }, data: [] };
            }
            // APPLIED to the junction fixture, so the re-read the box does
            // after a move sees the new seat — as the real gateway would.
            if (method === 'DELETE') {
                epicRequirements = epicRequirements.filter((l) =>
                    !(l.epic_fk === body.epic_fk && l.requirement_fk === body.requirement_fk));
            } else if (method === 'POST') {
                epicRequirements = [...epicRequirements, { ...body }];
            }
            return { httpStatus: { httpStatus: st }, data: [] };
        }
        if (method === 'PUT') {
            putBodies.push(body);
            return putStatus >= 200 && putStatus < 300
                ? Promise.resolve({ httpStatus: { httpStatus: putStatus }, data: [] })
                : Promise.reject({ httpStatus: { httpStatus: putStatus }, data: [] });
        }
        if (method === 'GET' && uri.includes('/requirements?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [requirementRow] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

const snackMessages = [];
vi.mock('../../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (selector) => selector({
        // Mirrors the real store: a status on the error object is appended to the
        // caller's text, so a handler that swallows the status fails a test.
        showError: (error, errorText) => snackMessages.push(
            errorText === undefined ? error
                : `${errorText}${error?.httpStatus?.httpStatus ? ` ${error.httpStatus.httpStatus}` : ''}`),
        close: () => {},
        open: false,
        message: '',
    }),
}));

import RequirementDetail from '../RequirementDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';
// UNMOCKED — the real card/toggle predicate (req #3493). `pipelineMembership.js`
// is never mocked in this file at all (only `hooks/useDataQueries` is, and only
// by overriding individual named exports), so this import resolves to the
// genuine function the browse toggle actually calls.
import { orchestratedRequirementIds } from '../../../utils/pipelineMembership';

let mountedRoots = [];

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    const render = () => root.render(
        <QueryClientProvider client={queryClient}>
            <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                    <RequirementDetail />
                </AuthContext.Provider>
            </AppContext.Provider>
        </QueryClientProvider>
    );
    act(() => { render(); });
    mountedRoots.push(root);
    // Re-render the same tree — what a route change to another :id does.
    const rerender = () => act(() => { render(); });
    return { container, rerender };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

const group = (c) => c.querySelector('[data-testid="requirement-orchestration-group"]');
const testid = (c, id) => c.querySelector(`[data-testid="${id}"]`);

// MUI renders a non-native Select's menu in a PORTAL on document.body, and it
// opens on MOUSEDOWN, not on click — a plain .click() leaves it closed and every
// option assertion sees an empty list.
async function openSelect(container, id) {
    const trigger = testid(container, id).querySelector('.MuiSelect-select');
    await act(async () => {
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    await flush();
    return Array.from(document.querySelectorAll('[role="option"]'));
}

async function chooseOption(container, id, label) {
    const options = await openSelect(container, id);
    const hit = options.find((o) => o.textContent === label);
    if (!hit) throw new Error(`no option "${label}" in [${options.map(o => o.textContent).join(', ')}]`);
    await act(async () => { hit.click(); });
    await flush();
}

async function closeMenu() {
    const backdrop = document.querySelector('.MuiModal-backdrop, .MuiBackdrop-root');
    if (backdrop) {
        await act(async () => { backdrop.click(); });
        await flush();
    }
}

function baseRequirement(overrides = {}) {
    return {
        id: 3435,
        title: 'Rebrand Initiative UI element',
        description: '',
        category_fk: 1,
        requirement_status: 'development',
        coordination_type: 'implemented',
        ai_model: 'opus',
        effort: 'high',
        machine_fk: null,
        started_at: null, completed_at: null, deferred_at: null,
        create_ts: null, update_ts: null,
        ...overrides,
    };
}

describe('RequirementDetail Orchestration box (req #3435)', { timeout: 30000 }, () => {
    beforeEach(() => {
        putBodies.length = 0;
        seatCalls.length = 0;
        seatStatus = { POST: 200, DELETE: 200 };
        snackMessages.length = 0;
        requirementRow = baseRequirement();
        putStatus = 200;
        queryErrors = {};
        epicRequirements = [...DEFAULT_EPIC_REQUIREMENTS];
        mountedRoots = [];
        routeId = '3435';
        seatGate = null;
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('is legended Orchestration, not Initiative', async () => {
        const { container } = mount();
        await flush();
        expect(group(container).querySelector('legend').textContent).toBe('Orchestration');
        expect(container.querySelector('[data-testid="requirement-initiative-linkage-group"]')).toBeNull();
    });

    it('carries the THREE rows, in plan → initiative → epic order', async () => {
        // Two rows until req #3365, which restored Initiative on the user's directive
        // ("Pipeline, Initiative and Epic (three rows)"). The row had been retired at
        // req #3357 because 1.0 lost the derivation with Feature; #3356 gave it
        // back through `epics.initiative_fk` and this restores the display.
        const { container } = mount();
        await flush();
        const box = group(container);
        const rows = ['orchestration-pipeline-row', 'orchestration-initiative-row',
            'orchestration-epic-row'];
        for (const r of rows) expect(testid(container, r)).not.toBeNull();
        // Order is the shape of the thing — a plan contains initiatives, an initiative
        // contains epics. CONTAINMENT, which is the plan model's own word.
        const order = rows.map((r) => Array.prototype.indexOf.call(
            box.children, testid(container, r)));
        expect(order).toEqual([...order].sort((a, b) => a - b));
        // The removed captions, asserted by their own words rather than by a
        // count of children. 'Initiative' is no longer among them — it is a row name
        // now — but the 1.0 prose that used to sit beside it still must not be.
        expect(box.textContent).not.toContain('via feature');
        expect(box.textContent).not.toContain('View on plan');
    });

    // req #3579 — "start with the pipeline selection active only and then
    // enabled initiative and epic setting". All three rows are selects now.
    it('renders pipeline, initiative and epic as selects', async () => {
        const { container } = mount();
        await flush();
        for (const id of ['orchestration-pipeline-select', 'orchestration-initiative-select',
            'orchestration-epic-select']) {
            expect(testid(container, id).querySelector('.MuiSelect-select')).not.toBeNull();
        }
    });

    it('names the plan, the initiative and the epic', async () => {
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('Darwin');
        expect(testid(container, 'orchestration-initiative-select').textContent).toBe('Orchestration UI');
        expect(testid(container, 'orchestration-epic-select').textContent)
            .toBe('Orchestration Box');
    });

    it('falls back to the epic id when the epic has no title', async () => {
        epicRequirements = [{ epic_fk: 300, requirement_fk: 3435 }];
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Epic 300');
    });

    // EACH BUTTON LANDS AT ITS OWN LEVEL. `?epic=` puts the camera on one CARD
    // (req #3498) and the bare plan link fits everything. Pointing both at the
    // plan would make one of the buttons decoration.
    //
    // `level=3` since req #3498, on the user's directive — this is the "single
    // epic zoom" they named, and the card it lands on is meant to show all its
    // detail. The value's own argument is on `EPIC_PLAN_LINK_LEVEL`.
    it('links each button at its own level of the plan', async () => {
        const { container } = mount();
        await flush();
        // `/swarm/pipeline/:id` — req #3356 collapsed the plan layer to one era
        // and the surviving visualizer took the unsuffixed route.
        expect(testid(container, 'orchestration-pipeline-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan');
        expect(testid(container, 'orchestration-initiative-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&initiative=20');
        expect(testid(container, 'orchestration-epic-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&epic=100&level=3');
    });

    // SEATED-VS-UNSEATED IS STRUCTURAL. With no epic carrying the requirement
    // there is no known plan either — the initiative fallback that used to fill this
    // gap left with the Initiative row.
    it('shows no pipeline and no epic when nothing seats the requirement', async () => {
        epicRequirements = [];
        const { container } = mount();
        await flush();

        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('No pipeline');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('No epic');
        expect(testid(container, 'orchestration-epic-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-pipeline-link').disabled).toBe(true);
        // req #3493 — the card/toggle predicate agrees: nothing to mark.
        expect(orchestratedRequirementIds(epicRequirements).has(3435)).toBe(false);
    });

    // req #3493 — THE CROSS-SURFACE AGREEMENT PROOF, fully seated. Exact values
    // (not `.not.toBe('No pipeline')`) — the box has fallback branches
    // (`Pipeline ${id}`, `Epic ${id}`, the wrong plan on a tie-break) that would
    // pass a negative assertion while still being wrong. `orchestratedRequirementIds`
    // is the REAL, unmocked card/toggle predicate, fed the exact same
    // `epicRequirements` array the box's `useAllPipelineEpicRequirements` mock
    // returns — one fixture, two independently-written readers, asserted to agree.
    it('agrees with the card/toggle predicate when fully seated', async () => {
        expect(orchestratedRequirementIds(epicRequirements).has(3435)).toBe(true);
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('Darwin');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Orchestration Box');
    });

    // req #3493 — THE KNOWN RESIDUAL, PINNED RATHER THAN LEFT UNSTATED. The two
    // readers do NOT compute the same function: the predicate only ever looks at
    // `requirement_fk`, while the box additionally walks
    // `epic_fk -> epics -> initiatives -> pipelines` and drops the seat
    // entirely when that walk fails to resolve (`orchestrationIndex.js`'s
    // `pipelineByEpic.get(sid) == null` branch — already covered on its own at
    // the `buildOrchestrationIndex` unit level by
    // `orchestrationIndex.test.js`'s "drops a seat whose epic names an initiative the
    // read does not carry"). A junction row naming an epic this plan-side read
    // does not carry — a dangling FK, or an epic dropped by the 3 MB bounded-list
    // truncation (`memory/mcp-server.md` § Bounded list reads) rather than a
    // failed read `planSideErrored` would catch — is EXACTLY that case, and it
    // reproduces the card-says-orchestrated / box-says-nothing contradiction
    // #3493 was filed over, on a narrower trigger than the retired 1.0/2.0 split.
    // Pinned here as an ACCEPTED, documented residual — not a regression this
    // session introduced or is scoped to close — so a future change to either
    // reader is honest about what it is changing.
    it('diverges from the card/toggle predicate when a seat names an epic the plan-side read does not carry', async () => {
        epicRequirements = [{ epic_fk: 99999, requirement_fk: 3435 }];
        expect(orchestratedRequirementIds(epicRequirements).has(3435)).toBe(true);
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('No pipeline');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('No epic');
    });

    it('disables every button — never a dead link — when nothing is linked', async () => {
        epicRequirements = [];
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-epic-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('No pipeline');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('No epic');
    });

    // ── The menu ────────────────────────────────────────────────────────────

    // Scoped to THIS plan alone (req #3357 — no initiative scoping left).
    it('offers only this plan’s epics', async () => {
        const { container } = mount();
        await flush();
        const labels = (await openSelect(container, 'orchestration-epic-select'))
            .map((o) => o.textContent);
        // Current epic first, then id ascending. 'Agent Boot' (200) is another plan.
        expect(labels).toEqual(['No epic', 'Orchestration Box', 'Plan Layer', 'Polish Round 2',
            'Polish Shipped', 'Epic 300']);
        await closeMenu();
    });

    // An epic has no state (req #3750): one whose work is all met still takes work.
    it('offers an epic whose requirements are all met', async () => {
        const { container } = mount();
        await flush();
        const labels = (await openSelect(container, 'orchestration-epic-select'))
            .map((o) => o.textContent);
        expect(labels).toContain('Polish Shipped');
        await closeMenu();
    });

    // A select whose own list denies its value renders blank, which reads as a
    // data bug rather than as a filter.
    it('offers the current epic first', async () => {
        epicRequirements = [{ epic_fk: 105, requirement_fk: 3435 },
            ...DEFAULT_EPIC_REQUIREMENTS.filter((l) => l.requirement_fk !== 3435)];
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-epic-select').textContent)
            .toBe('Polish Shipped');
        const labels = (await openSelect(container, 'orchestration-epic-select'))
            .map((o) => o.textContent);
        expect(labels[1]).toBe('Polish Shipped');
        await closeMenu();
    });

    // ── The write ───────────────────────────────────────────────────────────

    // DELETE the old seat, THEN insert the new — req #3356. This is not a
    // preference: `epic_requirements` keys on `requirement_fk` ALONE,
    // so the INSERT cannot succeed while the old row exists and insert-first
    // would fail 100% of the time on a move. `link_epic_requirement`
    // (darwin-mcp) says the same from the server side and names unlink-then-link
    // as the lawful move.
    it('re-seats by deleting the old link before inserting the new', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-epic-select', 'Polish Round 2');
        expect(seatCalls).toEqual([
            { method: 'DELETE', body: { epic_fk: 100, requirement_fk: 3435 } },
            { method: 'POST',   body: { epic_fk: 104, requirement_fk: 3435 } },
        ]);
    });

    it('seats an unseated requirement with an insert alone', async () => {
        epicRequirements = DEFAULT_EPIC_REQUIREMENTS.filter((l) => l.requirement_fk !== 3435);
        const { container } = mount();
        await flush();

        expect(testid(container, 'orchestration-epic-select').textContent).toBe('No epic');
        await chooseOption(container, 'orchestration-pipeline-select', 'Darwin');
        await chooseOption(container, 'orchestration-epic-select', 'Polish Round 2');
        expect(seatCalls).toEqual([
            { method: 'POST', body: { epic_fk: 104, requirement_fk: 3435 } },
        ]);
    });

    it('unseats with a delete alone when No epic is picked', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-epic-select', 'No epic');
        expect(seatCalls).toEqual([
            { method: 'DELETE', body: { epic_fk: 100, requirement_fk: 3435 } },
        ]);
    });

    it('does not re-save when the current epic is re-picked', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-epic-select', 'Orchestration Box');
        expect(seatCalls).toEqual([]);
    });

    // A failed DELETE must not have inserted anything: with the old row still
    // present the INSERT would violate the primary key anyway, and aborting
    // leaves the requirement exactly where it was.
    it('leaves the seat alone when the delete fails', async () => {
        const { container } = mount();
        await flush();

        seatStatus = { POST: 200, DELETE: 500 };
        await chooseOption(container, 'orchestration-epic-select', 'Polish Round 2');
        expect(seatCalls.map((c) => c.method)).toEqual(['DELETE']);
        expect(snackMessages.join(' ')).toContain('Unable to update epic 500');
    });

    // THE RESIDUAL THE KEY FORCES, pinned so it is a known state rather than a
    // surprise: a POST that fails after a successful DELETE leaves the
    // requirement seated NOWHERE. It is visible — the error is on screen and the
    // box reads "No epic" — and a person re-seats it in one pick.
    it('leaves the requirement unseated when the insert fails after the delete', async () => {
        const { container } = mount();
        await flush();

        seatStatus = { POST: 500, DELETE: 200 };
        await chooseOption(container, 'orchestration-epic-select', 'Polish Round 2');
        expect(seatCalls.map((c) => c.method)).toEqual(['DELETE', 'POST']);
        expect(snackMessages.join(' ')).toContain('Unable to update epic 500');
    });

    // The seat lives in the junction, NOT on the requirement row. A write to any
    // requirement column here would mean the handler reached for the wrong
    // table — which is exactly what an earlier revision of this box did, and
    // what made a wrong value invisible.
    //
    // Filtered rather than asserted empty: the page PUTs its description on blur,
    // and opening a menu blurs the field. That write is not this control's.
    it('writes no requirement column when re-seating', async () => {
        const { container } = mount();
        await flush();

        await chooseOption(container, 'orchestration-epic-select', 'Polish Round 2');
        const requirementEdits = putBodies.filter((body) => Array.isArray(body)
            && body.some((row) => Object.keys(row).some((k) => k !== 'id' && k !== 'description')));
        expect(requirementEdits).toEqual([]);
    });

    // ── Degradation ─────────────────────────────────────────────────────────

    it('reports the box unavailable when the plan-side reads fail', async () => {
        queryErrors = { epics: true };
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-error')).not.toBeNull();
        expect(testid(container, 'orchestration-pipeline-row')).toBeNull();
        expect(testid(container, 'orchestration-epic-row')).toBeNull();
    });

    // THE INITIATIVES READ IS A PLAN-SIDE READ (req #3356). It is only a JOIN HOP, but
    // losing it makes every epic planless — which renders identically to a
    // requirement that is genuinely seated nowhere. Reporting the box
    // unavailable is the honest answer; silently showing "No pipeline" is not.
    it('reports the box unavailable when the INITIATIVES read fails', async () => {
        queryErrors = { initiatives: true };
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-error')).not.toBeNull();
        expect(testid(container, 'orchestration-pipeline-row')).toBeNull();
    });

    // The three icon buttons were given aria-labels; the one control that
    // actually WRITES must have one too, or a screen reader announces its display
    // value as its own name.
    it('names the epic select for assistive technology', async () => {
        const { container } = mount();
        await flush();
        // MUI puts `inputProps` on the role="combobox" element, not on the
        // hidden native input — asserting the wrong node passes on a control
        // that has no accessible name at all.
        expect(testid(container, 'orchestration-epic-select')
            .querySelector('[role="combobox"]').getAttribute('aria-label')).toBe('Epic');
    });

    // ── The row names and their layout ──────────────────────────────────────

    // The names are unconditional: the icons match the nav entries they point at,
    // but they are only unambiguous once you know them.
    it('names every row', async () => {
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-label').textContent).toBe('Pipeline');
        expect(testid(container, 'orchestration-initiative-label').textContent).toBe('Initiative');
        expect(testid(container, 'orchestration-epic-label').textContent).toBe('Epic');
    });

    // COLUMN ORDER: name, then the view/zoom icon, then the item's title. The
    // icon sits BETWEEN them rather than leading the row, so the names form a
    // left column and the icons a second one.
    it('orders each row name → icon → value', async () => {
        const { container } = mount();
        await flush();

        for (const [level, valueId] of [
            ['pipeline', 'orchestration-pipeline-select'],
            ['initiative', 'orchestration-initiative-select'],
            ['epic', 'orchestration-epic-select'],
        ]) {
            const row = testid(container, `orchestration-${level}-row`);
            const kids = Array.prototype.slice.call(row.children);
            const at = (el) => kids.findIndex((k) => k === el || k.contains(el));
            const name = at(testid(container, `orchestration-${level}-label`));
            const icon = at(testid(container, `orchestration-${level}-link`));
            const value = at(testid(container, valueId));
            expect(name).toBeLessThan(icon);
            expect(icon).toBeLessThan(value);
        }
    });

    // The name occupies a FIXED column, so the icons line up at one x whatever
    // the word is — "Pipeline" and "Epic" are different widths.
    it('gives every row name the same fixed-width column', async () => {
        const { container } = mount();
        await flush();

        const widths = ['pipeline', 'initiative', 'epic'].map((l) =>
            getComputedStyle(testid(container, `orchestration-${l}-label`)).width);
        expect(new Set(widths).size).toBe(1);
        expect(widths[0]).not.toBe('');
        expect(widths[0]).not.toBe('auto');
    });

    // ── The cascade (req #3579) ─────────────────────────────────────────────

    const isDisabled = (c, id) => testid(c, id).querySelector('.MuiSelect-select')
        .getAttribute('aria-disabled') === 'true';

    it('starts with only the pipeline select live when nothing seats the requirement', async () => {
        epicRequirements = [];
        const { container } = mount();
        await flush();
        expect(isDisabled(container, 'orchestration-pipeline-select')).toBe(false);
        expect(isDisabled(container, 'orchestration-initiative-select')).toBe(true);
        expect(isDisabled(container, 'orchestration-epic-select')).toBe(true);
        expect(testid(container, 'orchestration-initiative-select').textContent).toBe('No initiative');
    });

    it('enables initiative and epic once a pipeline is chosen, and writes nothing for it', async () => {
        epicRequirements = [];
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-pipeline-select', 'Agent Harness');
        expect(isDisabled(container, 'orchestration-initiative-select')).toBe(false);
        expect(isDisabled(container, 'orchestration-epic-select')).toBe(false);
        expect(testid(container, 'orchestration-initiative-select').textContent).toBe('All initiatives');
        expect(testid(container, 'orchestration-pipeline-link').getAttribute('href'))
            .toBe('/swarm/pipeline/79?mode=plan');
        expect(seatCalls).toEqual([]);
        const labels = (await openSelect(container, 'orchestration-epic-select'))
            .map((o) => o.textContent);
        expect(labels).toEqual(['No epic', 'Agent Boot']);
        await closeMenu();
    });

    it('offers only OPEN plans, ordered by title', async () => {
        const { container } = mount();
        await flush();
        const labels = (await openSelect(container, 'orchestration-pipeline-select'))
            .map((o) => o.textContent);
        expect(labels).toEqual(['No pipeline', 'Agent Harness', 'Darwin']);
        await closeMenu();
    });

    it('offers the chosen plan\u2019s OPEN initiatives in sort order', async () => {
        const { container } = mount();
        await flush();
        const labels = (await openSelect(container, 'orchestration-initiative-select'))
            .map((o) => o.textContent);
        // 'Retired' is closed; 'Agent' belongs to another plan.
        expect(labels).toEqual(['All initiatives', 'Polish', 'Orchestration UI']);
        await closeMenu();
    });

    it('narrows the epics to the chosen initiative', async () => {
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-initiative-select', 'Polish');
        // The seat (epic 100) is in another initiative: the Epic row says the pick is
        // still to be made rather than showing an epic this initiative does not hold.
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Select an epic');
        expect(testid(container, 'orchestration-epic-link').disabled).toBe(true);
        expect(testid(container, 'orchestration-initiative-link').getAttribute('href'))
            .toBe('/swarm/pipeline/2?mode=plan&initiative=21');
        const labels = (await openSelect(container, 'orchestration-epic-select'))
            .map((o) => o.textContent);
        // No 'No epic' either: unseating from a scope the seat is not in would
        // remove it from a plan the reader is not looking at.
        expect(labels).toEqual(['Polish Tail']);
        await closeMenu();
        expect(seatCalls).toEqual([]);
    });

    it('All initiatives widens back to every epic of the plan', async () => {
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-initiative-select', 'All initiatives');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Orchestration Box');
        const labels = (await openSelect(container, 'orchestration-epic-select'))
            .map((o) => o.textContent);
        expect(labels).toEqual(['No epic', 'Orchestration Box', 'Plan Layer',
            'Polish Round 2', 'Polish Shipped', 'Polish Tail', 'Epic 300']);
        await closeMenu();
    });

    it('moves the seat to another plan through pipeline → epic', async () => {
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-pipeline-select', 'Agent Harness');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Select an epic');
        expect(seatCalls).toEqual([]);
        await chooseOption(container, 'orchestration-epic-select', 'Agent Boot');
        expect(seatCalls).toEqual([
            { method: 'DELETE', body: { epic_fk: 100, requirement_fk: 3435 } },
            { method: 'POST',   body: { epic_fk: 200, requirement_fk: 3435 } },
        ]);
    });

    it('re-picking the seat\u2019s own plan returns to the seat', async () => {
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-pipeline-select', 'Agent Harness');
        await chooseOption(container, 'orchestration-pipeline-select', 'Darwin');
        expect(testid(container, 'orchestration-initiative-select').textContent).toBe('Orchestration UI');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Orchestration Box');
    });

    it('unseats when No pipeline is picked on a seated requirement', async () => {
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-pipeline-select', 'No pipeline');
        expect(seatCalls).toEqual([
            { method: 'DELETE', body: { epic_fk: 100, requirement_fk: 3435 } },
        ]);
    });

    it('names the pipeline and initiative selects for assistive technology', async () => {
        const { container } = mount();
        await flush();
        for (const [id, name] of [['orchestration-pipeline-select', 'Pipeline'],
            ['orchestration-initiative-select', 'Initiative']]) {
            expect(testid(container, id).querySelector('[role="combobox"]')
                .getAttribute('aria-label')).toBe(name);
        }
    });

    // ── Review fixes (req #3579) ────────────────────────────────────────────

    // Never unseat from a plan the reader is not looking at: scoped elsewhere,
    // "No pipeline" drops the scope and returns to the seat.
    it('No pipeline while scoped to another plan returns to the seat without writing', async () => {
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-pipeline-select', 'Agent Harness');
        await chooseOption(container, 'orchestration-pipeline-select', 'No pipeline');
        expect(seatCalls).toEqual([]);
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('Darwin');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Orchestration Box');
    });

    // A met requirement is normally seated on a COMPLETED plan, which is not
    // offered as a destination — but it must stay pickable as the way back.
    it('keeps a closed seat plan pickable after scoping away from it', async () => {
        epicRequirements = [{ epic_fk: 801, requirement_fk: 3435 }];
        const { container } = mount();
        await flush();
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('Old Plan');
        await chooseOption(container, 'orchestration-pipeline-select', 'Darwin');
        const labels = (await openSelect(container, 'orchestration-pipeline-select'))
            .map((o) => o.textContent);
        expect(labels).toContain('Old Plan');
        await closeMenu();
        await chooseOption(container, 'orchestration-pipeline-select', 'Old Plan');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Old Epic');
        expect(seatCalls).toEqual([]);
    });

    it('follows the NEW seat once a move lands', async () => {
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-pipeline-select', 'Agent Harness');
        await chooseOption(container, 'orchestration-epic-select', 'Agent Boot');
        await flush();
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('Agent Harness');
        expect(testid(container, 'orchestration-initiative-select').textContent).toBe('Agent');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Agent Boot');
    });

    it('disables every select while a move is in flight', async () => {
        let release;
        seatGate = new Promise((r) => { release = r; });
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-epic-select', 'Polish Round 2');
        for (const id of ['orchestration-pipeline-select', 'orchestration-initiative-select',
            'orchestration-epic-select']) {
            expect(isDisabled(container, id)).toBe(true);
        }
        await act(async () => { release(); });
        await flush();
        expect(isDisabled(container, 'orchestration-pipeline-select')).toBe(false);
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Polish Round 2');
    });

    // The scope belongs to ONE requirement: Up/Down to another drops it.
    it('drops the scope when navigating to another requirement', async () => {
        epicRequirements = [...DEFAULT_EPIC_REQUIREMENTS, { epic_fk: 104, requirement_fk: 3436 }]
            .filter((l) => !(l.requirement_fk === 3437));
        const { container, rerender } = mount();
        await flush();
        await chooseOption(container, 'orchestration-pipeline-select', 'Agent Harness');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Select an epic');
        routeId = '3436';
        requirementRow = baseRequirement({ id: 3436 });
        rerender();
        await flush();
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('Darwin');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Polish Round 2');
    });

    it('keeps the scope and shows the seat as it stands when a move fails', async () => {
        const { container } = mount();
        await flush();
        await chooseOption(container, 'orchestration-pipeline-select', 'Agent Harness');
        seatStatus = { POST: 200, DELETE: 500 };
        await chooseOption(container, 'orchestration-epic-select', 'Agent Boot');
        expect(snackMessages.join(' ')).toContain('Unable to update epic 500');
        // Nothing moved: still seated on plan 2, still scoped to plan 79.
        expect(testid(container, 'orchestration-pipeline-select').textContent).toBe('Agent Harness');
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Select an epic');
        expect(isDisabled(container, 'orchestration-pipeline-select')).toBe(false);
    });

    it('disables Epic rather than open an empty menu', async () => {
        const { container } = mount();
        await flush();
        // Seated on plan 2, scoped to plan 79's 'Agent Spare', which holds no
        // epic: "No epic" is withheld out of scope, so the menu would be empty.
        await chooseOption(container, 'orchestration-pipeline-select', 'Agent Harness');
        await chooseOption(container, 'orchestration-initiative-select', 'Agent Spare');
        expect(isDisabled(container, 'orchestration-epic-select')).toBe(true);
        expect(testid(container, 'orchestration-epic-select').textContent).toBe('Select an epic');
    });

    // Req #3706 — a SEATED requirement deletes (the gateway CASCADEs its seat)
    // and every plan read that could still show the seat is re-read.
    it('deletes a seated requirement and re-reads the plan caches', async () => {
        const { default: callRestApi } = await import('../../../RestApi/RestApi');
        const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        try {
            const { container } = mount();
            await flush();
            expect(testid(container, 'orchestration-epic-select').textContent).toBe('Orchestration Box');
            await act(async () => { testid(container, 'btn-delete-requirement').click(); });
            await flush();
            const confirm = Array.from(document.querySelectorAll(
                '[data-testid="requirement-delete-dialog"] button'))
                .find((b) => b.textContent === 'Delete');
            await act(async () => { confirm.click(); });
            await flush();
            const deletes = callRestApi.mock.calls.filter(([uri, method]) =>
                method === 'DELETE' && uri.endsWith('/requirements'));
            expect(deletes.map(([, , body]) => body)).toEqual([{ id: 3435 }]);
            expect(seatCalls).toEqual([]);
            const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey));
            expect(keys).toEqual(expect.arrayContaining([
                JSON.stringify(['epic_requirements', 'tester']),
                JSON.stringify(['pipeline_compose']),
            ]));
            expect(snackMessages).toEqual([]);
        } finally {
            invalidate.mockRestore();
        }
    });

    it('names the lock when a seated requirement delete is refused (423)', async () => {
        const { default: callRestApi } = await import('../../../RestApi/RestApi');
        const lockMessage = 'cannot delete requirements 3435: it is seated on epic 100, '
            + 'locked by initiative 20 — unlock it first';
        const original = callRestApi.getMockImplementation();
        callRestApi.mockImplementation(async (uri, method, ...rest) => {
            if (method === 'DELETE' && uri.endsWith('/requirements')) {
                // eslint-disable-next-line no-throw-literal
                throw { data: null, httpStatus: { httpStatus: 423, httpMessage: lockMessage } };
            }
            return original(uri, method, ...rest);
        });
        try {
            const { container } = mount();
            await flush();
            await act(async () => { testid(container, 'btn-delete-requirement').click(); });
            await flush();
            const confirm = Array.from(document.querySelectorAll(
                '[data-testid="requirement-delete-dialog"] button'))
                .find((b) => b.textContent === 'Delete');
            await act(async () => { confirm.click(); });
            await flush();
            expect(snackMessages).toEqual([lockMessage]);
        } finally {
            callRestApi.mockImplementation(original);
        }
    });

});

