// @vitest-environment jsdom
//
// Req #2978 — the Machine pin chip group on the requirement detail page.
//
// A requirement can be pinned to a specific machine, or left "Any" (NULL, the
// default). The pin is what /swarm-start, /swarm-restart and /swarm-resume gate
// on, so the two directions that matter most are:
//   - picking a machine saves its `machines.id`
//   - picking "Any" saves NULL (via the REST 'NULL' string convention)
// A regression in either direction silently mis-routes swarm launches, so both
// are asserted against the REAL component and the REAL saveField PUT.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({
    useParams: () => ({ id: '42' }),
    useNavigate: () => () => {},
    useLocation: () => ({ state: {} }),
}));

const MACHINES = [
    { id: 7, title: 'Mac mini',  closed: 0, sort_order: 1 },
    { id: 9, title: 'WSL box',   closed: 0, sort_order: 2 },
    { id: 12, title: 'Old iMac', closed: 1, sort_order: 3 },  // retired — must NOT be offered
];

// `useMachines` is produced by createEntityQueries, so its fetch happens INSIDE
// the factory module and a fetchEntity mock would not intercept it. Override the
// hook the component actually consumes instead.
vi.mock('../../../hooks/useDataQueries', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useMachines: () => ({ data: MACHINES }),
        useAllCategories: () => ({ data: [{ id: 1, category_name: 'Swarm' }] }),
    };
});

// The detail page's own fetches go through call_rest_api directly. Serve the
// requirement on GET and record PUTs so we can assert what was saved.
let requirementRow;
const putBodies = [];
vi.mock('../../../RestApi/RestApi', () => ({
    default: vi.fn((uri, method, body) => {
        if (method === 'PUT') {
            putBodies.push(body);
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
        }
        if (method === 'GET' && uri.includes('/requirements?id=')) {
            return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [requirementRow] });
        }
        return Promise.resolve({ httpStatus: { httpStatus: 200 }, data: [] });
    }),
}));

import RequirementDetail from '../RequirementDetail';
import AuthContext from '../../../Context/AuthContext';
import AppContext from '../../../Context/AppContext';

let mountedRoots = [];

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const root = createRoot(container);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: 'http://test.local' }}>
                    <AuthContext.Provider value={{ idToken: 'tok', profile: { userName: 'tester', timezone: 'UTC' } }}>
                        <RequirementDetail />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
    mountedRoots.push(root);
    return { container };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
}

const chip = (container, key) =>
    container.querySelector(`[data-testid="machine-${key}"]`);

// MUI renders the Chip label in a span; the clickable node is the chip root.
const chipLabels = (container) =>
    Array.from(container.querySelectorAll('[data-testid="machine-selector"] .MuiChip-root'))
        .map(el => el.textContent);

const isSelected = (el) => !el.classList.contains('MuiChip-outlined');

function baseRequirement(overrides = {}) {
    return {
        id: 42,
        title: 'pin me',
        description: '',
        category_fk: 1,
        requirement_status: 'swarm_ready',   // editable AND un-faded
        coordination_type: 'implemented',
        ai_model: 'opus',
        effort: 'xhigh',
        machine_fk: null,
        started_at: null, completed_at: null, deferred_at: null,
        create_ts: null, update_ts: null,
        ...overrides,
    };
}

describe('RequirementDetail machine pin (req #2978)', () => {
    beforeEach(() => {
        putBodies.length = 0;
        requirementRow = baseRequirement();
        mountedRoots = [];
    });
    afterEach(() => {
        act(() => { mountedRoots.forEach((r) => r.unmount()); });
        document.body.innerHTML = '';
    });

    it('offers Any first plus only OPEN machines, in sort_order', async () => {
        const { container } = mount();
        await flush();

        expect(chipLabels(container)).toEqual(['Any', 'Mac mini', 'WSL box']);
        // The retired machine must not be offerable as a new pin.
        expect(chip(container, 12)).toBeNull();
    });

    it('selects Any when machine_fk is NULL', async () => {
        const { container } = mount();
        await flush();

        expect(isSelected(chip(container, 'any'))).toBe(true);
        expect(isSelected(chip(container, 7))).toBe(false);
    });

    it('selects the pinned machine when machine_fk is set', async () => {
        requirementRow = baseRequirement({ machine_fk: 9 });
        const { container } = mount();
        await flush();

        expect(isSelected(chip(container, 9))).toBe(true);
        expect(isSelected(chip(container, 'any'))).toBe(false);
    });

    it('saves the machine id when a machine chip is clicked', async () => {
        const { container } = mount();
        await flush();

        await act(async () => { chip(container, 7).click(); });
        await flush();

        expect(putBodies).toEqual([[{ id: 42, machine_fk: 7 }]]);
    });

    it('saves NULL when Any is clicked (clears the pin)', async () => {
        requirementRow = baseRequirement({ machine_fk: 7 });
        const { container } = mount();
        await flush();

        await act(async () => { chip(container, 'any').click(); });
        await flush();

        // REST PUT NULL convention — the literal string, not JS null.
        expect(putBodies).toEqual([[{ id: 42, machine_fk: 'NULL' }]]);
    });

    it('does not re-save when the already-selected chip is clicked', async () => {
        const { container } = mount();
        await flush();

        await act(async () => { chip(container, 'any').click(); });
        await flush();

        expect(putBodies).toEqual([]);
    });

    it('still renders a pin to a RETIRED machine so it can be seen and cleared', async () => {
        requirementRow = baseRequirement({ machine_fk: 12 });
        const { container } = mount();
        await flush();

        const retired = chip(container, 12);
        expect(retired).not.toBeNull();
        expect(retired.textContent).toContain('Old iMac');
        expect(isSelected(retired)).toBe(true);
        // ...and it must not have silently fallen back to "Any".
        expect(isSelected(chip(container, 'any'))).toBe(false);
    });

    // The pin is a planning-time decision, so it must be BOTH clickable and
    // visually live in all three editable statuses. A regression that fades the
    // row in authoring/approved (e.g. by copying the AI Settings group's
    // `!swarm_ready` fade rule) makes a working control look disabled.
    for (const status of ['authoring', 'approved', 'swarm_ready']) {
        it(`is editable and NOT faded in '${status}'`, async () => {
            requirementRow = baseRequirement({ requirement_status: status });
            const { container } = mount();
            await flush();

            const macMini = chip(container, 7);
            expect(macMini.classList.contains('Mui-disabled')).toBe(false);

            // The row wrapper must not be dimmed.
            // The row wrapper must not be dimmed. MUI's `sx` compiles to a CSS
            // class, so the inline `style.opacity` is always empty — assert the
            // COMPUTED value or this check silently passes on a faded row.
            const row = container.querySelector('[data-testid="machine-selector"]').parentElement;
            expect(row).not.toBeNull();
            expect(getComputedStyle(row).opacity).toBe('1');

            // ...and the click must actually persist.
            await act(async () => { macMini.click(); });
            await flush();
            expect(putBodies).toEqual([[{ id: 42, machine_fk: 7 }]]);
        });
    }

    it('disables the chips when the requirement is not in an editable status', async () => {
        requirementRow = baseRequirement({ requirement_status: 'met' });
        const { container } = mount();
        await flush();

        expect(chip(container, 7).classList.contains('Mui-disabled')).toBe(true);

        await act(async () => { chip(container, 7).click(); });
        await flush();
        expect(putBodies).toEqual([]);
    });
});
