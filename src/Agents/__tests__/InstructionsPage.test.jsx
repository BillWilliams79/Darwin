// @vitest-environment jsdom
//
// Req #3063 — the WIRING of the edit-in-place instruction card.
//
// GhostTextField.test.jsx pins the commit contract in isolation and
// instructionsApi.test.js pins the REST wire format. Neither can see the layer
// between them, which is where this page's real risk lives: whether the card
// hands the right arguments to the right action at the right moment, and whether
// the field's callbacks land anywhere useful.
//
// Everything worth testing here is a JOIN of two pieces that are each already
// green on their own:
//
//   * onErrorChange -> fieldErrors -> rowBlocked -> the "unsaved" chip. A blocked
//     field has no Save button to leave disabled, so this chip is the ONLY signal
//     that a value was not written. Both halves pass in isolation while the chip
//     never renders.
//   * The membership queue's fresh-slot read. `bindAgent` passes a THUNK so the
//     slot is computed when the queue reaches the write, not when the chip was
//     clicked. A version that computed it eagerly is indistinguishable from this
//     one in every single-write test.
//   * bind-all's per-agent slots. The API test proves an array body goes out; only
//     the page can prove each agent got ITS OWN next slot rather than a shared one.
//   * The graduated close decision. `row.refs.length === 0` is read from the LIVE
//     row, and the two branches do genuinely different things — one writes
//     immediately, one must not write until a dialog is confirmed.
//
// Mounted harness with raw react-dom + act: the house pattern (see
// CategoryCard.templatefocus.test.jsx), because there is no @testing-library in
// this repo. The action module is mocked so the assertions are about ARGUMENTS;
// the data hooks are mocked so a "refetch" is a controlled re-render.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }));

// Module-level query data — mutate then `bump()` to simulate a refetch landing.
let instructionsData = [];
let agentsData = [];
let junctionData = [];

vi.mock('../../hooks/useDataQueries', () => ({
    useInstructions: () => ({ data: instructionsData, isLoading: false }),
    useAgents: () => ({ data: agentsData }),
    useAgentInstructions: () => ({ data: junctionData }),
    instructionKeys: { all: (c) => ['instructions', c] },
    agentInstructionKeys: { all: (c) => ['agent_instructions', c] },
}));

vi.mock('../actions/instructionsApi', () => ({
    createInstruction: vi.fn(),
    updateInstruction: vi.fn(),
    deleteInstruction: vi.fn(),
    linkAgentInstruction: vi.fn(),
    linkAgentInstructions: vi.fn(),
    unlinkAgentInstruction: vi.fn(),
}));

import InstructionsPage from '../InstructionsPage';
import * as api from '../actions/instructionsApi';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

const URI = 'http://test.local';
const TOKEN = 'tok';
const CREATOR = 'tester';

// ---------------------------------------------------------------------------
// Fixture. Row 10 is BOUND to two agents (blast radius, challenge on delete,
// rename notice); row 11 is UNBOUND (the other side of every graduated branch).
// The two bound agents sit at DIFFERENT junction slots on purpose — a bind-all
// that collapsed to one shared slot would still pass against equal ones.
// ---------------------------------------------------------------------------
const AGENTS = [
    { id: 1, name: 'Alpha', closed: 0 },
    { id: 2, name: 'Bravo', closed: 0 },
    { id: 3, name: 'Charlie', closed: 0 },
];
const INSTRUCTIONS = [
    { id: 10, name: 'Bound Rule', content: 'body ten', closed: 0, update_ts: '2026-07-02T00:00:00' },
    { id: 11, name: 'Lonely Rule', content: 'body eleven', closed: 0, update_ts: '2026-07-01T00:00:00' },
];
const JUNCTION = [
    { agent_fk: 1, instruction_fk: 10, sort_order: 1 },
    { agent_fk: 2, instruction_fk: 10, sort_order: 5 },
];

let container;
let root;
let queryClient;
let bump;

function Harness() {
    const [, setTick] = useState(0);
    bump = () => setTick(t => t + 1);
    return <InstructionsPage />;
}

// The REAL cache key the junction query lives under. `agentInstructions` is
// declared `fieldsInKey: true` in devopsQueries, so the factory appends a
// `{ fields }` segment — the page's own key factory (`agentInstructionKeys.all`)
// returns only the PREFIX, which is why `freshAgentInstructions` has to reach the
// data with `getQueriesData` (prefix match) rather than `getQueryData` (exact).
//
// Seeding the full key rather than the bare prefix is what makes that load-bearing:
// against the prefix alone an exact-match lookup would find the row too, and the
// test would pass while production silently fell through to the stale ref.
const JUNCTION_KEY = ['agent_instructions', CREATOR,
    { fields: 'agent_fk,instruction_fk,sort_order' }];

const mount = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The queue's fresh-slot read goes through the CACHE, not through the mocked
    // hook — so the cache has to actually hold the junction rows.
    queryClient.setQueryData(JUNCTION_KEY, junctionData);
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: URI }}>
                    <AuthContext.Provider value={{ idToken: TOKEN, profile: { userName: CREATOR } }}>
                        <Harness />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
};

beforeEach(() => {
    // A stored sort mode would silently reorder the cards and break position-based
    // reads; the page default (Agent Count, desc) is what these tests assume.
    localStorage.clear();
    sessionStorage.clear();
    instructionsData = INSTRUCTIONS.map(i => ({ ...i }));
    agentsData = AGENTS.map(a => ({ ...a }));
    junctionData = JUNCTION.map(l => ({ ...l }));
    for (const fn of Object.values(api)) {
        fn.mockReset();
        fn.mockResolvedValue({});
    }
    api.unlinkAgentInstruction.mockResolvedValue(true);
    navigateSpy.mockReset();
    useSnackBarStore.setState({ open: false, message: '' });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// DOM helpers. Menus and dialogs render into portals on document.body, so every
// lookup is document-wide rather than container-scoped.
// ---------------------------------------------------------------------------
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

const click = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});

const clickAsync = async (el) => { await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}); };

// A controlled React input ignores `el.value = x`; the write has to go through the
// native setter so React's change tracking sees it.
const typeInto = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

const focus = (el) => act(() => el.focus());
const blur = async (el) => { await act(async () => { el.blur(); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

// A refetch landing. The new ARRAY IDENTITY is the load-bearing part, not the
// contents: TanStack hands back a fresh array on every settle, which is what
// re-runs the page's data-dependent effects. Re-rendering with the same reference
// would leave the drill-through latch untested — it only has anything to latch
// against when the identity actually changes.
const refetch = async () => { await act(async () => {
    instructionsData = instructionsData.map(i => ({ ...i }));
    junctionData = junctionData.map(l => ({ ...l }));
    bump();
}); };

const openRowMenu = (rowId) => click(byTestId(`instruction-card-menu-${rowId}`));

// ===========================================================================

describe('InstructionsPage — the graduated close decision', () => {
    it('closes an UNBOUND row immediately, with no dialog', async () => {
        mount();
        openRowMenu(11);

        // No ellipsis: the label itself is the promise that nothing else happens.
        expect(byTestId('instruction-menu-close-11').textContent)
            .toBe('Close instruction');

        await clickAsync(byTestId('instruction-menu-close-11'));
        await flush();

        expect(api.updateInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 11, { closed: 1 });
        expect(byTestId('instruction-delete-dialog')).toBeNull();
    });

    it('sends a BOUND row through the dialog and writes nothing until it is confirmed', async () => {
        mount();
        openRowMenu(10);

        // The ellipsis is the only thing distinguishing the two menu items.
        expect(byTestId('instruction-menu-close-10').textContent)
            .toBe('Close instruction…');

        await clickAsync(byTestId('instruction-menu-close-10'));
        await flush();

        // The blast radius has to be on screen BEFORE anything is written.
        expect(api.updateInstruction).not.toHaveBeenCalled();
        expect(byTestId('instruction-delete-dialog')).not.toBeNull();
        // Titled for the intent it was opened with — a dialog headed "Delete …"
        // reached from a menu item labelled Close is a lie.
        expect(document.querySelector('.MuiDialogTitle-root').textContent)
            .toContain('Close');

        await clickAsync(byTestId('instruction-delete-close-btn'));
        await flush();

        expect(api.updateInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 10, { closed: 1 });
    });

    it('always dialogs for a DELETE, even on an unbound row', async () => {
        // Close is reversible; delete cascades the junction rows away. The
        // graduation applies to one of them only.
        mount();
        openRowMenu(11);
        await clickAsync(byTestId('instruction-menu-delete-11'));
        await flush();

        expect(api.deleteInstruction).not.toHaveBeenCalled();
        expect(byTestId('instruction-delete-dialog')).not.toBeNull();
        // No typed-name challenge below two bindings.
        expect(byTestId('instruction-delete-challenge-input')).toBeNull();

        await clickAsync(byTestId('instruction-delete-confirm-btn'));
        await flush();

        expect(api.deleteInstruction).toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 11);
    });

    it('gates a SHARED row behind the typed-name challenge', async () => {
        mount();
        openRowMenu(10);
        await clickAsync(byTestId('instruction-menu-delete-10'));
        await flush();

        const confirmBtn = byTestId('instruction-delete-confirm-btn');
        expect(confirmBtn.disabled).toBe(true);

        await clickAsync(confirmBtn);
        expect(api.deleteInstruction).not.toHaveBeenCalled();

        typeInto(byTestId('instruction-delete-challenge-input'), 'Bound Rule');
        await clickAsync(byTestId('instruction-delete-confirm-btn'));
        await flush();

        expect(api.deleteInstruction).toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 10);
    });

    it('reopens a closed row with no dialog — restoring a duty discloses nothing', async () => {
        instructionsData = [{ ...INSTRUCTIONS[0], closed: 1 }, { ...INSTRUCTIONS[1] }];
        mount();
        // Closed rows are hidden until the filter is on.
        expect(byTestId('instruction-row-10')).toBeNull();
        await clickAsync(byTestId('instructions-show-closed'));

        openRowMenu(10);
        await clickAsync(byTestId('instruction-menu-reopen-10'));
        await flush();

        expect(api.updateInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 10, { closed: 0 });
        expect(byTestId('instruction-delete-dialog')).toBeNull();
    });
});

describe('InstructionsPage — unbind goes through useConfirmDialog', () => {
    const unbindChipDelete = (rowId, agentId) =>
        byTestId(`instruction-${rowId}-agent-${agentId}`)
            .querySelector('.MuiChip-deleteIcon');

    it('opens the dialog rather than unbinding on the spot', async () => {
        mount();
        await clickAsync(unbindChipDelete(10, 1));

        expect(api.unlinkAgentInstruction).not.toHaveBeenCalled();
        expect(byTestId('instruction-unbind-dialog')).not.toBeNull();
        expect(document.querySelector('.MuiDialogTitle-root').textContent)
            .toBe('Unbind from Alpha?');
    });

    it('carries the agent SLOT into the dialog, because a rebind will not restore it', async () => {
        // The one consequence the card itself cannot show: the junction row is
        // deleted, and a later rebind appends at max+1 rather than restoring the
        // banded position.
        mount();
        await clickAsync(unbindChipDelete(10, 2));

        const warning = byTestId('instruction-unbind-slot-warning');
        expect(warning).not.toBeNull();
        expect(warning.textContent).toContain('#5');   // Bravo's junction sort_order
    });

    it('writes nothing when the dialog is cancelled', async () => {
        mount();
        await clickAsync(unbindChipDelete(10, 1));
        await clickAsync(byTestId('instruction-unbind-cancel-btn'));
        await flush();

        expect(api.unlinkAgentInstruction).not.toHaveBeenCalled();
    });

    it('unbinds exactly that one (agent, instruction) pair on confirm', async () => {
        mount();
        await clickAsync(unbindChipDelete(10, 1));
        await clickAsync(byTestId('instruction-unbind-confirm-btn'));
        await flush();

        expect(api.unlinkAgentInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 1, 10);
    });

    it('does not confuse two rows — the dialog acts on the row it was opened from', async () => {
        // `infoObject` carries the row; a version reading the last-hovered or
        // last-rendered row would pass every single-row test above.
        junctionData = [
            ...JUNCTION,
            { agent_fk: 1, instruction_fk: 11, sort_order: 2 },
        ];
        mount();

        await clickAsync(unbindChipDelete(11, 1));
        await clickAsync(byTestId('instruction-unbind-confirm-btn'));
        await flush();

        expect(api.unlinkAgentInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 1, 11);
    });
});

describe('InstructionsPage — binding computes a per-agent load-order slot', () => {
    const openPalette = (rowId) => clickAsync(byTestId(`instruction-${rowId}-agent-add`));

    it('binds one agent at ITS OWN next slot, not the row-wide maximum', async () => {
        // Charlie (3) has no links at all, so the correct slot is 1 — even though
        // this instruction already loads at 1 and 5 on other agents. Reading the
        // instruction's slots instead of the agent's would give 6.
        mount();
        await openPalette(10);
        await clickAsync(byTestId('instruction-10-bind-3'));
        await flush();

        expect(api.linkAgentInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 3, 10, 1);
    });

    it('appends after an agent\'s existing bindings', async () => {
        mount();
        await openPalette(11);
        await clickAsync(byTestId('instruction-11-bind-2'));
        await flush();

        // Bravo already holds slot 5 -> the next free one is 6.
        expect(api.linkAgentInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 2, 11, 6);
    });

    it('bind-all sends ONE bulk call with a distinct slot per agent', async () => {
        // The failure this catches: computing the slot once and reusing it. Every
        // agent here has a different next slot (2, 6, 1), so a shared value cannot
        // hide behind a coincidence.
        mount();
        await openPalette(11);
        await clickAsync(byTestId('instruction-11-agent-bind-all'));
        await flush();

        expect(api.linkAgentInstruction).not.toHaveBeenCalled();
        expect(api.linkAgentInstructions).toHaveBeenCalledOnce();

        const [, , rows] = api.linkAgentInstructions.mock.calls[0];
        expect(rows).toEqual([
            { agent_fk: 1, instruction_fk: 11, sort_order: 2 },
            { agent_fk: 2, instruction_fk: 11, sort_order: 6 },
            { agent_fk: 3, instruction_fk: 11, sort_order: 1 },
        ]);
    });

    it('offers bind-all only from two remaining agents up', async () => {
        // At one remaining agent it is that agent's chip with a longer label.
        mount();
        await openPalette(10);                       // only Charlie is bindable
        expect(byTestId('instruction-10-agent-bind-all')).toBeNull();
        expect(byTestId('instruction-10-bind-3')).not.toBeNull();
    });
});

describe('InstructionsPage — the membership queue serializes and re-reads', () => {
    it('holds the second write until the first has finished', async () => {
        let releaseFirst;
        api.linkAgentInstruction.mockImplementationOnce(
            () => new Promise(res => { releaseFirst = res; }));

        mount();
        await clickAsync(byTestId('instruction-10-agent-add'));
        await clickAsync(byTestId('instruction-11-agent-add'));

        await clickAsync(byTestId('instruction-10-bind-3'));
        await clickAsync(byTestId('instruction-11-bind-3'));
        await flush();

        // Both chips were clicked; only one write is in flight.
        expect(api.linkAgentInstruction).toHaveBeenCalledTimes(1);

        await act(async () => { releaseFirst({}); });
        await flush();

        expect(api.linkAgentInstruction).toHaveBeenCalledTimes(2);
    });

    it('computes the queued write\'s slot from the cache AS IT IS WHEN THE WRITE RUNS', async () => {
        // The reason the queue exists. Two cards binding the SAME agent both read
        // the pre-write cache if the slot is computed eagerly, both compute the
        // same slot, and both inserts succeed — the junction PK is
        // (agent_fk, instruction_fk), so nothing rejects them. That agent then
        // loads two instructions at one position, in arbitrary order.
        let releaseFirst;
        api.linkAgentInstruction.mockImplementationOnce(
            () => new Promise(res => { releaseFirst = res; }));

        mount();
        await clickAsync(byTestId('instruction-10-agent-add'));
        await clickAsync(byTestId('instruction-11-agent-add'));

        await clickAsync(byTestId('instruction-10-bind-3'));   // Charlie: slot 1
        await clickAsync(byTestId('instruction-11-bind-3'));   // queued
        await flush();

        // The first write lands and its refetch reaches the cache — which is what
        // the queued task is supposed to read.
        junctionData = [...junctionData, { agent_fk: 3, instruction_fk: 10, sort_order: 1 }];
        queryClient.setQueryData(JUNCTION_KEY, junctionData);
        await act(async () => { releaseFirst({}); });
        await flush();

        expect(api.linkAgentInstruction).toHaveBeenNthCalledWith(1, URI, TOKEN, 3, 10, 1);
        // 2, not 1 — the slot was read after the first write, not when the chip
        // was clicked.
        expect(api.linkAgentInstruction).toHaveBeenNthCalledWith(2, URI, TOKEN, 3, 11, 2);
    });

    it('a failed bind does not wedge every later bind on the page', async () => {
        // The queue is advanced with `.catch(() => {})` for exactly this reason.
        api.linkAgentInstruction
            .mockRejectedValueOnce({ httpStatus: { httpStatus: 500, httpMessage: 'boom' } });

        mount();
        await clickAsync(byTestId('instruction-10-agent-add'));
        await clickAsync(byTestId('instruction-10-bind-3'));
        await flush();

        expect(useSnackBarStore.getState().open).toBe(true);

        await clickAsync(byTestId('instruction-11-agent-add'));
        await clickAsync(byTestId('instruction-11-bind-3'));
        await flush();

        expect(api.linkAgentInstruction).toHaveBeenCalledTimes(2);
    });
});

describe('InstructionsPage — a blocked field is reported on the card', () => {
    const nameField = (rowId) => byTestId(`instruction-name-input-${rowId}`);

    it('raises the "unsaved" chip, because there is no Save button to leave disabled', async () => {
        mount();
        expect(byTestId('instruction-unsaved-10')).toBeNull();

        focus(nameField(10));
        typeInto(nameField(10), 'Lonely Rule');       // the OTHER row's name
        await blur(nameField(10));

        expect(api.updateInstruction).not.toHaveBeenCalled();
        expect(byTestId('instruction-unsaved-10')).not.toBeNull();
    });

    it('retracts the chip as soon as the value becomes writable again', async () => {
        mount();
        focus(nameField(10));
        typeInto(nameField(10), 'Lonely Rule');
        await blur(nameField(10));
        expect(byTestId('instruction-unsaved-10')).not.toBeNull();

        focus(nameField(10));
        typeInto(nameField(10), 'A Free Name');
        await flush();

        expect(byTestId('instruction-unsaved-10')).toBeNull();
    });

    it('marks only the row that is blocked', async () => {
        // `fieldErrors` is keyed `${rowId}:${field}`; a flat boolean would light
        // every card on the page.
        mount();
        focus(nameField(10));
        typeInto(nameField(10), 'Lonely Rule');
        await blur(nameField(10));

        expect(byTestId('instruction-unsaved-10')).not.toBeNull();
        expect(byTestId('instruction-unsaved-11')).toBeNull();
    });

    it('clears the chip when the blocked row leaves the list', async () => {
        // GhostTextField retracts its verdict on unmount. Without that the error
        // key outlives the card and the chip reappears as a phantom the next time
        // the row renders.
        mount();
        focus(nameField(10));
        typeInto(nameField(10), 'Lonely Rule');
        await blur(nameField(10));
        expect(byTestId('instruction-unsaved-10')).not.toBeNull();

        instructionsData = [{ ...INSTRUCTIONS[1] }];
        await refetch();
        instructionsData = INSTRUCTIONS.map(i => ({ ...i }));
        await refetch();

        expect(byTestId('instruction-unsaved-10')).toBeNull();
    });
});

describe('InstructionsPage — one PUT per field', () => {
    const nameField = (rowId) => byTestId(`instruction-name-input-${rowId}`);
    const contentField = (rowId) => byTestId(`instruction-content-input-${rowId}`);

    it('writes only the column that was edited', async () => {
        mount();
        focus(nameField(10));
        typeInto(nameField(10), 'Renamed Rule');
        await blur(nameField(10));
        await flush();

        expect(api.updateInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 10, { name: 'Renamed Rule' });
    });

    it('stores content VERBATIM while trimming a name', async () => {
        // `content` is prose an agent loads as-is and its leading whitespace can be
        // deliberate; `name` sits under a NO PAD unique key, where "  x  " and "x"
        // are different rows and the padded one blocks the clean one invisibly.
        mount();
        focus(nameField(10));
        typeInto(nameField(10), '   Padded Name   ');
        await blur(nameField(10));
        await flush();
        expect(api.updateInstruction)
            .toHaveBeenCalledWith(URI, TOKEN, 10, { name: 'Padded Name' });

        api.updateInstruction.mockClear();
        focus(contentField(10));
        typeInto(contentField(10), '  indented body  ');
        await blur(contentField(10));
        await flush();
        expect(api.updateInstruction)
            .toHaveBeenCalledWith(URI, TOKEN, 10, { content: '  indented body  ' });
    });

    it('reverts the field AND reports the failure when the write is rejected', async () => {
        // commitField rethrows so GhostTextField rolls back — the field must never
        // keep displaying a value the database refused.
        api.updateInstruction.mockRejectedValue(
            { httpStatus: { httpStatus: 500, httpMessage: 'SQL FAILED' } });

        mount();
        focus(nameField(10));
        typeInto(nameField(10), 'Doomed Name');
        await blur(nameField(10));
        await flush();

        expect(nameField(10).value).toBe('Bound Rule');
        expect(useSnackBarStore.getState().open).toBe(true);
    });

    it('announces a rename only for a SHARED row', async () => {
        mount();
        focus(nameField(11));                          // unbound
        typeInto(nameField(11), 'Quiet Rename');
        await blur(nameField(11));
        await flush();
        expect(byTestId('instruction-rename-warning')).toBeNull();

        focus(nameField(10));                          // two agents
        typeInto(nameField(10), 'Loud Rename');
        await blur(nameField(10));
        await flush();
        expect(byTestId('instruction-rename-warning')).not.toBeNull();
    });
});

describe('InstructionsPage — the template row creates in place', () => {
    const draftName = () => byTestId('instruction-name-input-template');
    const draftContent = () => byTestId('instruction-content-input-template');

    it('waits for BOTH required columns before posting', async () => {
        mount();
        focus(draftName());
        typeInto(draftName(), 'Half A Row');
        await blur(draftName());
        await flush();

        expect(api.createInstruction).not.toHaveBeenCalled();

        focus(draftContent());
        typeInto(draftContent(), 'the binding text');
        await blur(draftContent());
        await flush();

        expect(api.createInstruction).toHaveBeenCalledExactlyOnceWith(URI, TOKEN, {
            name: 'Half A Row', content: 'the binding text', creator_fk: CREATOR,
        });
    });

    it('posts once, not twice, when both fields are blurred in turn', async () => {
        // Both fields call maybeCreate on EVERY blur (that is what makes a failed
        // create retryable). The `creating` latch plus the cleared draft are what
        // keep it idempotent.
        mount();
        focus(draftName());
        typeInto(draftName(), 'Once Only');
        focus(draftContent());
        typeInto(draftContent(), 'body');
        await blur(draftContent());
        await flush();
        focus(draftName());
        await blur(draftName());
        await flush();

        expect(api.createInstruction).toHaveBeenCalledOnce();
    });

    it('empties the draft after a successful create — the next row inherits nothing', async () => {
        // The defect the CONTROLLED mode exists to prevent: a local copy left the
        // sibling field holding the created row's text, which the next row then
        // silently adopted as its binding content.
        mount();
        focus(draftName());
        typeInto(draftName(), 'Fresh Row');
        focus(draftContent());
        typeInto(draftContent(), 'fresh body');
        await blur(draftContent());
        await flush();

        expect(draftName().value).toBe('');
        expect(draftContent().value).toBe('');
    });

    it('says WHY a duplicate name was refused — the template has no unsaved chip', async () => {
        // The row cards report a blocked field with the "unsaved" chip. The
        // template row has no `onErrorChange`, so its outlined helper text is the
        // only signal that the create did not happen. Without it the user types a
        // name, tabs away, and nothing at all occurs.
        mount();
        focus(draftName());
        typeInto(draftName(), 'Bound Rule');
        await flush();

        const helper = byTestId('instruction-row-template')
            .querySelector('.MuiFormHelperText-root');
        expect(helper).not.toBeNull();
        expect(helper.textContent).toContain('already exists');
    });

    it('refuses a name that is already taken, closed rows included', async () => {
        // `instructions.name` carries a UNIQUE key that does NOT exclude closed
        // rows, so colliding with an invisible one is the confusing failure.
        instructionsData = [
            ...INSTRUCTIONS.map(i => ({ ...i })),
            { id: 12, name: 'Retired Rule', content: 'x', closed: 1 },
        ];
        mount();
        focus(draftName());
        typeInto(draftName(), 'Retired Rule');
        focus(draftContent());
        typeInto(draftContent(), 'body');
        await blur(draftContent());
        await flush();

        expect(api.createInstruction).not.toHaveBeenCalled();
    });

    it('keeps the draft when the create fails, so the next blur retries it', async () => {
        api.createInstruction.mockRejectedValue(
            { httpStatus: { httpStatus: 500, httpMessage: 'SQL FAILED' } });

        mount();
        focus(draftName());
        typeInto(draftName(), 'Retry Me');
        focus(draftContent());
        typeInto(draftContent(), 'body');
        await blur(draftContent());
        await flush();

        expect(useSnackBarStore.getState().open).toBe(true);
        expect(draftName().value).toBe('Retry Me');
        expect(draftContent().value).toBe('body');

        api.createInstruction.mockResolvedValue({});
        focus(draftContent());
        await blur(draftContent());
        await flush();

        expect(api.createInstruction).toHaveBeenCalledTimes(2);
    });

    it('carries no chips and no menu — membership needs a row id first', async () => {
        // This is what retired the two-phase create-then-link failure, where a
        // successful POST followed by a failed link left a row bound to nobody.
        mount();
        const template = byTestId('instruction-row-template');
        expect(template.querySelector('[data-testid*="-agent-add"]')).toBeNull();
        expect(template.querySelector('[data-testid^="instruction-card-menu-"]')).toBeNull();
    });
});

describe('InstructionsPage — the agent chips are the membership control', () => {
    const cardIds = () => [...document.querySelectorAll('[data-testid^="instruction-row-"]')]
        .map(el => el.dataset.testid);

    it('shows the bound agents at rest and unfurls the rest only on request', async () => {
        mount();
        // Bound: solid chips, always on. Unbound: nothing until the palette opens.
        expect(byTestId('instruction-10-agent-1')).not.toBeNull();
        expect(byTestId('instruction-10-agent-2')).not.toBeNull();
        expect(byTestId('instruction-10-bind-3')).toBeNull();

        await clickAsync(byTestId('instruction-10-agent-add'));
        expect(byTestId('instruction-10-bind-3')).not.toBeNull();

        await clickAsync(byTestId('instruction-10-agent-add'));
        expect(byTestId('instruction-10-bind-3')).toBeNull();
    });

    it('keeps a CLOSED agent\'s binding removable rather than disabling the chip', async () => {
        // A closed agent boots nothing, so the binding loads nothing — but it is
        // still real data a hard delete would cascade away. MUI's `disabled` would
        // kill both the drill-through and the ✕ and strand the row.
        agentsData = [{ ...AGENTS[0], closed: 1 }, ...AGENTS.slice(1)];
        mount();

        const chip = byTestId('instruction-10-agent-1');
        expect(chip).not.toBeNull();                       // canonical testid survives
        expect(chip.dataset.agentClosed).toBe('1');
        expect(chip.textContent).toContain('(closed)');
        expect(chip.querySelector('.MuiChip-deleteIcon')).not.toBeNull();

        // ...and it is not offered as a bind target, because it is already bound.
        await clickAsync(byTestId('instruction-11-agent-add'));
        expect(byTestId('instruction-11-bind-1')).toBeNull();   // closed agents are not bindable
        expect(byTestId('instruction-11-bind-2')).not.toBeNull();
    });

    it('drills through to the agent page from a bound chip', async () => {
        mount();
        await clickAsync(byTestId('instruction-10-agent-1'));
        expect(navigateSpy).toHaveBeenCalledExactlyOnceWith('/agents/1#instructions');
    });

    it('flags an unbound row, because "0 agents" is the state worth noticing', () => {
        mount();
        expect(byTestId('instruction-unbound-11')).not.toBeNull();
        expect(byTestId('instruction-unbound-10')).toBeNull();
    });

    it('orders the browse list by blast radius by default', () => {
        // The page default is Agent Count desc — the row twelve architects load
        // leads, not the one that happens to sort first alphabetically.
        expect(localStorage.getItem('darwin-instructions-sort')).toBeNull();
        mount();
        expect(cardIds()).toEqual([
            'instruction-row-10',        // 2 agents
            'instruction-row-11',        // 0 agents
            'instruction-row-template',  // always last
        ]);
    });
});

describe('InstructionsPage — the sort control', () => {
    const cardIds = () => [...document.querySelectorAll('[data-testid^="instruction-row-"]')]
        .map(el => el.dataset.testid)
        .filter(id => id !== 'instruction-row-template');

    const openSortMenu = () => click(byTestId('instructions-settings-button'));

    // A closed MUI Menu keeps its nodes in the portal and marks the container
    // `aria-hidden` — the transition that would remove them never runs in jsdom.
    // Presence is therefore not openness; reachability is.
    const sortMenuOpen = () => {
        const list = byTestId('instructions-sort-menu');
        return !!list && list.closest('[aria-hidden="true"]') === null;
    };

    it('adopts a newly picked mode\'s natural direction and closes', async () => {
        mount();
        openSortMenu();
        expect(sortMenuOpen()).toBe(true);
        await clickAsync(byTestId('instructions-sort-name'));

        expect(cardIds()).toEqual(['instruction-row-10', 'instruction-row-11']);  // A→Z
        expect(sortMenuOpen()).toBe(false);
    });

    it('reverses when the ACTIVE mode is picked again, and stays open to show it', async () => {
        // CategoryCard's shipped idiom. The arrow is the only affordance saying the
        // second click reverses rather than doing nothing, so the menu must not
        // close before the user can see it move.
        mount();
        openSortMenu();
        await clickAsync(byTestId('instructions-sort-name'));
        openSortMenu();
        await clickAsync(byTestId('instructions-sort-name'));

        expect(cardIds()).toEqual(['instruction-row-11', 'instruction-row-10']);  // Z→A
        expect(sortMenuOpen()).toBe(true);                                        // still open
    });

    it('persists the mode across a remount but NOT the direction', async () => {
        // A standing preference about the catalog, so the mode is cross-tab
        // localStorage. The direction deliberately resets, or a user who flipped to
        // "fewest agents" once comes back tomorrow to a page burying its headline
        // rows with no memory of having asked for it.
        mount();
        openSortMenu();
        await clickAsync(byTestId('instructions-sort-name'));
        openSortMenu();
        await clickAsync(byTestId('instructions-sort-name'));      // now Z→A
        expect(cardIds()).toEqual(['instruction-row-11', 'instruction-row-10']);

        act(() => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mount();

        expect(localStorage.getItem('darwin-instructions-sort')).toBe('name');
        expect(cardIds()).toEqual(['instruction-row-10', 'instruction-row-11']);  // back to A→Z
    });
});

describe('InstructionsPage — the drill-through from an agent page', () => {
    const setHash = (h) => { window.location.hash = h; };

    beforeEach(() => {
        setHash('');
        // jsdom implements neither of these.
        Element.prototype.scrollIntoView = vi.fn();
    });
    afterEach(() => { setHash(''); });

    it('scrolls to the targeted row', async () => {
        setHash('#instruction-11');
        mount();
        await flush();

        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        expect(document.getElementById('instruction-11')).not.toBeNull();
    });

    it('reveals a CLOSED target rather than landing on nothing', async () => {
        // The list filters closed rows out by default, so without this the pencil
        // on an agent page would navigate to an empty viewport and look broken.
        instructionsData = [{ ...INSTRUCTIONS[0] }, { ...INSTRUCTIONS[1], closed: 1 }];
        setHash('#instruction-11');
        mount();
        await flush();

        expect(byTestId('instruction-row-11')).not.toBeNull();
        expect(byTestId('instruction-closed-11')).not.toBeNull();
    });

    it('scrolls ONCE — a later save must not yank the viewport back', async () => {
        // Every field save refetches and hands back a new `instructions` identity,
        // which the effect depends on. Without the latch the page would smooth-
        // scroll to the drill-through target after every single edit, for as long
        // as the hash sat in the URL.
        setHash('#instruction-11');
        mount();
        await flush();
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

        await refetch();
        await refetch();

        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    });
});

describe('InstructionsPage — a write invalidates exactly what it changed', () => {
    // The two invalidators are a deliberate distinction, and getting it wrong has
    // no visible symptom at the moment of the mistake — the page just quietly
    // shows a stale number until something else happens to refetch.
    const invalidatedKeys = () => queryClient.invalidateQueries.mock.calls
        .map(([arg]) => JSON.stringify(arg?.queryKey));

    const spyOnInvalidate = () => {
        queryClient.invalidateQueries = vi.fn(() => Promise.resolve());
    };

    it('touches ONLY the instruction query for a field edit — no junction row moved', async () => {
        mount();
        spyOnInvalidate();

        const name = byTestId('instruction-name-input-10');
        focus(name);
        typeInto(name, 'Renamed');
        await blur(name);
        await flush();

        expect(invalidatedKeys()).toEqual([JSON.stringify(['instructions', CREATOR])]);
    });

    it('drops BOTH caches for a membership edit — the count chips derive from the junction', async () => {
        // `refs` is a useMemo over the whole agent_instructions query. Invalidating
        // only the rows would leave "2 agents" on a card that now binds three, and
        // the newly bound agent would still be offered in the palette.
        mount();
        await clickAsync(byTestId('instruction-10-agent-add'));
        spyOnInvalidate();
        await clickAsync(byTestId('instruction-10-bind-3'));
        await flush();

        expect(new Set(invalidatedKeys())).toEqual(new Set([
            JSON.stringify(['instructions', CREATOR]),
            JSON.stringify(['agent_instructions', CREATOR]),
        ]));
    });

    it('drops both caches for a hard DELETE, which cascades the junction rows away', async () => {
        mount();
        openRowMenu(11);
        await clickAsync(byTestId('instruction-menu-delete-11'));
        spyOnInvalidate();
        await clickAsync(byTestId('instruction-delete-confirm-btn'));
        await flush();

        expect(new Set(invalidatedKeys())).toEqual(new Set([
            JSON.stringify(['instructions', CREATOR]),
            JSON.stringify(['agent_instructions', CREATOR]),
        ]));
    });

    it('resyncs even when the write FAILED — the caches now disagree with the database', async () => {
        // The resync runs BEFORE the error is reported, so a failure in the
        // reporting path cannot skip it.
        api.updateInstruction.mockRejectedValue(
            { httpStatus: { httpStatus: 500, httpMessage: 'SQL FAILED' } });
        mount();
        spyOnInvalidate();

        const name = byTestId('instruction-name-input-10');
        focus(name);
        typeInto(name, 'Doomed');
        await blur(name);
        await flush();

        expect(invalidatedKeys()).toContain(JSON.stringify(['instructions', CREATOR]));
        expect(useSnackBarStore.getState().open).toBe(true);
    });
});

describe('InstructionsPage — focus after a create is returned, not stolen', () => {
    const draftName = () => byTestId('instruction-name-input-template');
    const draftContent = () => byTestId('instruction-content-input-template');

    // The restoration is deferred to a macrotask, one full round trip after the
    // user's blur — so it has to be awaited as one, not flushed as a microtask.
    const settleTimers = async () => { await act(async () => {
        await new Promise(r => setTimeout(r, 0));
    }); };

    const fillDraft = async () => {
        focus(draftName());
        typeInto(draftName(), 'Typed Row');
        focus(draftContent());
        typeInto(draftContent(), 'body');
        await blur(draftContent());
        await flush();
    };

    it('puts the caret back in the blank template so a second row can be typed', async () => {
        mount();
        await fillDraft();
        await settleTimers();

        expect(document.activeElement).toBe(draftName());
    });

    it('does NOT steal focus out of a row the user has already moved to', async () => {
        // This is the whole reason the restoration is guarded rather than
        // unconditional. It fires a full round trip after the blur that triggered
        // it; yanking focus out of another row would fire THAT row's blur and
        // commit whatever half-typed text was sitting in it.
        mount();
        await fillDraft();

        const otherRow = byTestId('instruction-name-input-10');
        focus(otherRow);
        typeInto(otherRow, 'half-typed, not ready');

        await settleTimers();

        expect(document.activeElement).toBe(otherRow);
        expect(otherRow.value).toBe('half-typed, not ready');
        // ...and nothing committed it on the way past.
        expect(api.updateInstruction).not.toHaveBeenCalled();
    });
});

describe('InstructionsPage — the accounting line counts the whole catalog', () => {
    it('does not change when a view filter is toggled', async () => {
        // An accounting line that moved with the filter would not be an accounting
        // line. Counted over `instructions`, never over the filtered `rows`.
        instructionsData = [
            ...INSTRUCTIONS.map(i => ({ ...i })),
            { id: 12, name: 'Retired Rule', content: 'x', closed: 1 },
        ];
        mount();
        const before = byTestId('instructions-accounting').textContent;
        expect(before).toBe('2 instructions · 1 not bound · 1 closed');

        await clickAsync(byTestId('instructions-show-closed'));

        expect(byTestId('instructions-accounting').textContent).toBe(before);
    });
});
