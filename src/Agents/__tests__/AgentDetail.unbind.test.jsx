// @vitest-environment jsdom
//
// Req #3071 — the agent-side unbind now goes through the SHARED dialog.
//
// What is actually at risk in this change is the WIRING, not the dialog: the page
// stopped calling `window.confirm` and started handing a payload to
// `useConfirmDialog`, whose effect fires the write one tick later with an
// `infoObject` that the hook clears in the same pass. Three ways that goes wrong,
// all of which a "does the dialog appear?" test would miss:
//
//   * the write runs anyway (the confirm gate was removed but nothing replaced it);
//   * the write runs on the WRONG instruction (the payload is read from the last
//     render rather than from the row that was clicked);
//   * the slot warning is empty, because the junction `sort_order` lives on the
//     link and not on the instruction row — so a version that passed the
//     instruction alone still renders a dialog, just a less honest one.
//
// Mounted harness with raw react-dom + act, the house pattern — same shape as
// InstructionsPage.test.jsx, which pins the other direction of this same unbind.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => navigateSpy,
    useParams: () => ({ id: '1' }),
}));

// Module-level query data — reassigned per test before mount.
let agentsData = [];
let instructionsData = [];
let junctionData = [];

vi.mock('../../hooks/useDataQueries', () => ({
    useAgents: () => ({ data: agentsData, isLoading: false }),
    useInstructions: () => ({ data: instructionsData }),
    useArchitectureDocuments: () => ({ data: [] }),
    useAgentDocuments: () => ({ data: [] }),
    useAgentInstructions: () => ({ data: junctionData }),
    agentKeys: { all: (c) => ['agents', c] },
    instructionKeys: { all: (c) => ['instructions', c] },
    agentInstructionKeys: { all: (c) => ['agent_instructions', c] },
}));

vi.mock('../actions/instructionsApi', () => ({
    linkAgentInstruction: vi.fn(),
    unlinkAgentInstruction: vi.fn(),
    setAgentInstructionOrder: vi.fn(),
}));

// Only reached by the overview field's blur, which no test here touches — mocked
// so an accidental one cannot make a network call.
vi.mock('../../RestApi/RestApi', () => ({ default: vi.fn() }));

import AgentDetail from '../AgentDetail';
import * as api from '../actions/instructionsApi';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

const URI = 'http://test.local';
const TOKEN = 'tok';
const CREATOR = 'tester';

// ---------------------------------------------------------------------------
// Fixture. ONE agent with TWO bound instructions at DIFFERENT junction slots —
// equal slots would let a version that reads the wrong link still pass the slot
// assertion, and a single bound row would let one that reads "the only row"
// pass the row-identity assertion.
// ---------------------------------------------------------------------------
const AGENT = {
    id: 1, name: 'Alpha', closed: 0, ai_model: 'opus', effort: 'high',
    overview: 'the alpha agent', location: 'alpha.md', file_name: 'alpha.md',
};
const INSTRUCTIONS = [
    { id: 10, name: 'First Rule', content: 'body ten', closed: 0 },
    { id: 11, name: 'Second Rule', content: 'body eleven', closed: 0 },
];
const JUNCTION = [
    { agent_fk: 1, instruction_fk: 10, sort_order: 3 },
    { agent_fk: 1, instruction_fk: 11, sort_order: 7 },
];

let container;
let root;
let queryClient;

const mount = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: URI }}>
                    <AuthContext.Provider value={{ idToken: TOKEN, profile: { userName: CREATOR } }}>
                        <AgentDetail />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
};

beforeEach(() => {
    agentsData = [{ ...AGENT }];
    instructionsData = INSTRUCTIONS.map(i => ({ ...i }));
    junctionData = JUNCTION.map(l => ({ ...l }));

    for (const fn of Object.values(api)) {
        fn.mockReset();
        fn.mockResolvedValue({});
    }
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

// Dialogs render into a portal on document.body, so lookups are document-wide.
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

const clickAsync = async (el) => { await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}); };

const flush = async () => { await act(async () => {
    await Promise.resolve(); await Promise.resolve();
}); };

const unlinkBtn = (instructionId) => byTestId(`agent-instruction-unlink-${instructionId}`);

describe('AgentDetail — unbind goes through useConfirmDialog, not window.confirm', () => {
    it('opens the shared dialog rather than unbinding on the spot', async () => {
        // The regression this whole requirement exists for: a `window.confirm` here
        // would have BLOCKED this click instead of rendering anything, which is the
        // same thing that hangs a Playwright run with no dialog handler registered.
        mount();
        await clickAsync(unlinkBtn(10));

        expect(api.unlinkAgentInstruction).not.toHaveBeenCalled();
        expect(byTestId('instruction-unbind-dialog')).not.toBeNull();
    });

    it('reuses the instructions page dialog — same component, both directions', async () => {
        // The testids are InstructionUnbindDialog's own. Asserting on them is what
        // pins the sharing decision: a second, agent-side-only dialog would render
        // different ones and this fails rather than silently duplicating the copy.
        mount();
        await clickAsync(unlinkBtn(10));

        expect(byTestId('instruction-unbind-cancel-btn')).not.toBeNull();
        expect(byTestId('instruction-unbind-confirm-btn')).not.toBeNull();
        expect(document.querySelector('.MuiDialogTitle-root').textContent)
            .toBe('Unbind from Alpha?');
    });

    it('names BOTH halves of the pair, so the agent-side dialog says which instruction', async () => {
        // From this page the agent is obvious and the instruction is the question —
        // the reverse of the instructions page. The shared copy has to answer both.
        mount();
        await clickAsync(unlinkBtn(11));

        const text = document.querySelector('.MuiDialog-container').textContent;
        expect(text).toContain('Second Rule');
        expect(text).toContain('Alpha');
    });

    it('carries the JUNCTION slot, which the window.confirm it replaced never did', async () => {
        // sort_order lives on the link, not on the instruction. Passing the
        // instruction alone still renders a dialog — just one missing the single
        // consequence a rebind cannot restore.
        mount();
        await clickAsync(unlinkBtn(11));

        const warning = byTestId('instruction-unbind-slot-warning');
        expect(warning).not.toBeNull();
        expect(warning.textContent).toContain('#7');   // Second Rule's junction slot
    });

    it('writes nothing when the dialog is cancelled', async () => {
        mount();
        await clickAsync(unlinkBtn(10));
        await clickAsync(byTestId('instruction-unbind-cancel-btn'));
        await flush();

        expect(api.unlinkAgentInstruction).not.toHaveBeenCalled();
    });

    it('unbinds exactly that one (agent, instruction) pair on confirm', async () => {
        mount();
        await clickAsync(unlinkBtn(10));
        await clickAsync(byTestId('instruction-unbind-confirm-btn'));
        await flush();

        expect(api.unlinkAgentInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 1, 10);
    });

    it('does not confuse two rows — it acts on the row it was opened from', async () => {
        // Deliberately the SECOND row. `infoObject` carries the row, and the classic
        // way to get this wrong is to read `myInstructions[0]` (or the last-hovered
        // row) instead of the clicked one — which is indistinguishable from correct
        // for as long as every confirm in the file happens to be fired on row 10.
        mount();
        await clickAsync(unlinkBtn(11));
        await clickAsync(byTestId('instruction-unbind-confirm-btn'));
        await flush();

        expect(api.unlinkAgentInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 1, 11);
    });

    it('renders the binding it is closing on, not a blank, after the confirm', async () => {
        // `useConfirmDialog` clears `infoObject` in the SAME pass that fires the
        // callback, so on the next render the dialog's props are undefined while it
        // is still fading out. Without the `lastShown` ref it returns null there and
        // pops off the screen instead of transitioning. Nothing else notices: every
        // other test in this file asserts on state BEFORE that render.
        mount();
        await clickAsync(unlinkBtn(11));
        await clickAsync(byTestId('instruction-unbind-confirm-btn'));

        const dialog = byTestId('instruction-unbind-dialog');
        expect(dialog).not.toBeNull();
        expect(dialog.textContent).toContain('Second Rule');
    });

    it('writes once and reports no error when confirm is clicked twice during the exit fade', async () => {
        // The button stays mounted and clickable through MUI's ~195ms close, so the
        // second click re-fires the effect with the already-cleared `{}` payload.
        // The `if (row)` guard absorbs it.
        //
        // The call-count assertion ALONE cannot see that guard. Unlike ContextPage —
        // where `performDelete(run.id)` derefs in the argument expression and throws
        // out of the effect — `unlinkInstruction(row)` is async and derefs
        // `instruction.id` inside its OWN try, so an unguarded second fire is caught
        // by its own catch and lands in `reportInstructionError`. The visible damage
        // is a false "Could not unlink the instruction" toast (plus a redundant cache
        // invalidation) sitting on top of an unbind that in fact succeeded — and the
        // API is still called exactly once either way. So the snackbar is what
        // actually pins this.
        mount();
        await clickAsync(unlinkBtn(10));
        const confirmBtn = byTestId('instruction-unbind-confirm-btn');
        await clickAsync(confirmBtn);
        await clickAsync(confirmBtn);
        await flush();

        expect(api.unlinkAgentInstruction)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 1, 10);
        expect(useSnackBarStore.getState().open).toBe(false);
    });

    it('omits the slot warning when the junction row carries no sort_order', async () => {
        // `sort_order` is nullable, and the card itself renders `#—` for it. A
        // warning naming slot "#null" would be worse than no warning.
        junctionData = [{ agent_fk: 1, instruction_fk: 10, sort_order: null }];
        instructionsData = [{ ...INSTRUCTIONS[0] }];
        mount();
        await clickAsync(unlinkBtn(10));

        expect(byTestId('instruction-unbind-dialog')).not.toBeNull();
        expect(byTestId('instruction-unbind-slot-warning')).toBeNull();
    });

    it('invalidates the junction cache after the write, so the list resyncs', async () => {
        // The unbind is pessimistic: nothing is applied locally, so the refetch IS
        // the update. Skipping it leaves the card showing a binding that is gone.
        mount();
        const spy = vi.spyOn(queryClient, 'invalidateQueries');

        await clickAsync(unlinkBtn(10));
        await clickAsync(byTestId('instruction-unbind-confirm-btn'));
        await flush();

        const keys = spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
        expect(keys).toContain(JSON.stringify(['agent_instructions', CREATOR]));
    });
});
