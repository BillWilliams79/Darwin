// @vitest-environment jsdom
//
// Req #3067 — the Table view's WIRING.
//
// Mounted through InstructionsPage, not in isolation, and deliberately so: every
// claim worth making about this view is a claim about it sharing the PAGE's
// machinery with the card view, and a standalone harness would let each of them
// pass against a private copy.
//
// The four things that would break silently:
//
//   * THE CLOSED CELL MUST NOT WRITE. It is an affordance for the page's graduated
//     handler — unbound closes immediately, BOUND opens the blast-radius dialog. A
//     checkbox wired straight to `updateInstruction` looks identical, passes any
//     test that only checks "the row closed", and puts silent unloading of twelve
//     architects' boot payloads one stray click from every row.
//   * ONE PUT PER FIELD, from the table exactly as from the card. A shared
//     `commitField` is the mechanism; only a test that inspects the ARGUMENTS can
//     tell it apart from a table-local writer that happens to work today.
//   * THE UNSAVED MARKER. There is no Save button, so with the marker missing a
//     blocked value is indistinguishable from a saved one. Both halves are
//     asserted: no write, and a visible signal.
//   * ONE MEMBERSHIP QUEUE. The table must feed the page's serialized queue, not
//     open a second one — two queues re-create the max(sort_order)+1 race the
//     single queue exists to remove.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }));

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

const URI = 'http://test.local';
const TOKEN = 'tok';
const CREATOR = 'tester';

// Row 10 is BOUND (blast radius, the dialog path); row 11 is UNBOUND (the
// immediate path). Every graduated branch needs both sides.
const seed = () => {
    instructionsData = [
        { id: 10, name: 'bound-rule', content: 'Body of the bound rule.', closed: 0,
          create_ts: '2026-07-01 10:00:00', update_ts: '2026-07-10 10:00:00' },
        { id: 11, name: 'lonely-rule', content: 'Body of the lonely rule.', closed: 0,
          create_ts: '2026-07-02 10:00:00', update_ts: null },
    ];
    agentsData = [
        { id: 1, name: 'alpha', closed: 0 },
        { id: 2, name: 'beta', closed: 0 },
    ];
    junctionData = [
        { agent_fk: 1, instruction_fk: 10, sort_order: 1 },
        { agent_fk: 2, instruction_fk: 10, sort_order: 5 },
    ];
};

let container;
let root;

beforeEach(() => {
    seed();
    vi.clearAllMocks();
    api.updateInstruction.mockResolvedValue({});
    api.linkAgentInstruction.mockResolvedValue({});
    api.linkAgentInstructions.mockResolvedValue({});
    // The view preference is read from storage on mount; pin it to the table.
    sessionStorage.setItem('darwin-instructions-view', 'table');
    localStorage.setItem('darwin-instructions-view', 'table');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    sessionStorage.clear();
    localStorage.clear();
});

const mount = async () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AuthContext.Provider value={{ profile: { userName: CREATOR }, idToken: TOKEN }}>
                    <AppContext.Provider value={{ darwinUri: URI }}>
                        <InstructionsPage />
                    </AppContext.Provider>
                </AuthContext.Provider>
            </QueryClientProvider>);
    });
};

const one = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);
const all = (testId) => document.body.querySelectorAll(`[data-testid="${testId}"]`);

const click = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

const typeInto = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

const editField = async (testId, value) => {
    const el = one(testId);
    act(() => el.focus());
    typeInto(el, value);
    await act(async () => { el.blur(); });
};

describe('InstructionsTableView — it really is the table', () => {
    it('renders the grid rather than the card registry', async () => {
        await mount();
        expect(one('instructions-datagrid')).toBeTruthy();
        expect(one('instructions-registry')).toBeFalsy();
        expect(one('view-toggle-table').getAttribute('aria-pressed')).toBe('true');
    });

    it('carries the SAME field testids as the cards — one contract, two views', async () => {
        // This is the assertion behind the whole requirement. If these ids diverged
        // per view, no test could ever prove the two views commit identically.
        await mount();
        expect(one('instruction-name-input-10')).toBeTruthy();
        expect(one('instruction-content-input-10')).toBeTruthy();
        expect(one('instruction-name-input-template')).toBeTruthy();
        expect(one('instruction-content-input-template')).toBeTruthy();
    });

    it('renders each row field exactly once', async () => {
        await mount();
        expect(all('instruction-name-input-10')).toHaveLength(1);
        expect(all('instruction-content-input-10')).toHaveLength(1);
    });
});

describe('InstructionsTableView — one PUT per field', () => {
    it('writes only the name column when the name cell commits', async () => {
        await mount();
        await editField('instruction-name-input-10', 'renamed-rule');

        expect(api.updateInstruction).toHaveBeenCalledTimes(1);
        const [, , id, body] = api.updateInstruction.mock.calls[0];
        expect(id).toBe(10);
        // Asserted as a KEY SET: a rejected name must not be able to take an edited
        // body down with it.
        expect(Object.keys(body)).toEqual(['name']);
        expect(body.name).toBe('renamed-rule');
    });

    it('writes only the content column when the content cell commits', async () => {
        await mount();
        await editField('instruction-content-input-10', 'Rewritten body.');

        expect(api.updateInstruction).toHaveBeenCalledTimes(1);
        const [, , , body] = api.updateInstruction.mock.calls[0];
        expect(Object.keys(body)).toEqual(['content']);
    });

    it('normalizes a name before storing it — NO PAD collation makes padding real', async () => {
        await mount();
        await editField('instruction-name-input-10', '  spaced   out  ');
        expect(api.updateInstruction.mock.calls[0][3].name).toBe('spaced out');
    });
});

describe('InstructionsTableView — a blocked value writes NOTHING and says so', () => {
    it('refuses a duplicate name, keeps it visible, and raises the row marker', async () => {
        await mount();
        await editField('instruction-name-input-10', 'lonely-rule');   // row 11's name

        expect(api.updateInstruction).not.toHaveBeenCalled();
        // The dirty text survives the blur rather than silently reverting.
        expect(one('instruction-name-input-10').value).toBe('lonely-rule');
        // The table's replacement for the card's `unsaved` chip.
        expect(one('instruction-unsaved-10')).toBeTruthy();
    });

    it('suppresses the per-field caption, which has nowhere to go in a fixed row', async () => {
        await mount();
        await editField('instruction-name-input-10', 'lonely-rule');
        expect(one('instruction-name-input-10-message')).toBeFalsy();
    });

    it('clears the marker once the value is fixed', async () => {
        await mount();
        await editField('instruction-name-input-10', 'lonely-rule');
        expect(one('instruction-unsaved-10')).toBeTruthy();

        await editField('instruction-name-input-10', 'a-fine-name');
        expect(one('instruction-unsaved-10')).toBeFalsy();
        expect(api.updateInstruction).toHaveBeenCalledTimes(1);
    });

    it('raises no marker on a row that is merely being edited', async () => {
        await mount();
        await editField('instruction-name-input-11', 'still-lonely');
        expect(one('instruction-unsaved-11')).toBeFalsy();
    });
});

describe('InstructionsTableView — the closed cell is gated on blast radius', () => {
    it('closes an UNBOUND row immediately, with no dialog', async () => {
        await mount();
        await act(async () => {
            one('instruction-closed-toggle-11').click();
        });
        expect(one('instruction-delete-dialog')).toBeFalsy();
        expect(api.updateInstruction).toHaveBeenCalledTimes(1);
        expect(api.updateInstruction.mock.calls[0][2]).toBe(11);
        expect(api.updateInstruction.mock.calls[0][3]).toEqual({ closed: 1 });
    });

    it('routes a BOUND row through the dialog and writes NOTHING until confirmed', async () => {
        // The regression that would matter most: a checkbox that PUT `closed`
        // directly would pass a "the row closed" assertion and silently drop the
        // instruction out of two agents' boot payloads with no disclosure.
        await mount();
        await act(async () => {
            one('instruction-closed-toggle-10').click();
        });
        expect(api.updateInstruction).not.toHaveBeenCalled();
        expect(one('instruction-delete-dialog')).toBeTruthy();
    });

    it('reopens without ceremony — it restores a duty rather than removing one', async () => {
        instructionsData[1].closed = 1;
        await mount();
        // Closed rows are hidden until the filter is on.
        click(one('instructions-show-closed'));
        await act(async () => {
            one('instruction-closed-toggle-11').click();
        });
        expect(one('instruction-delete-dialog')).toBeFalsy();
        expect(api.updateInstruction.mock.calls[0][3]).toEqual({ closed: 0 });
    });
});

describe('InstructionsTableView — membership from the row', () => {
    it('binds one agent at max+1 through the page queue', async () => {
        await mount();
        click(one('instruction-11-agent-add'));
        await act(async () => {
            one('instruction-11-bind-1').dispatchEvent(
                new MouseEvent('click', { bubbles: true }));
        });
        expect(api.linkAgentInstruction).toHaveBeenCalledTimes(1);
        const [, , agentId, rowId, slot] = api.linkAgentInstruction.mock.calls[0];
        expect(agentId).toBe(1);
        expect(rowId).toBe(11);
        // agent 1 already holds slot 1 on row 10, so its next free slot is 2.
        expect(slot).toBe(2);
    });

    it('binds the rest in ONE bulk call, each with its own slot', async () => {
        await mount();
        click(one('instruction-11-agent-add'));
        await act(async () => {
            one('instruction-11-agent-bind-all').dispatchEvent(
                new MouseEvent('click', { bubbles: true }));
        });
        expect(api.linkAgentInstructions).toHaveBeenCalledTimes(1);
        const rows = api.linkAgentInstructions.mock.calls[0][2];
        expect(rows).toEqual([
            { agent_fk: 1, instruction_fk: 11, sort_order: 2 },
            { agent_fk: 2, instruction_fk: 11, sort_order: 6 },
        ]);
    });

    it('drills through to the agent page', async () => {
        await mount();
        click(one('instruction-10-agent-1'));
        expect(navigateSpy).toHaveBeenCalledWith('/agents/1#instructions');
    });

    it('asks before unbinding rather than writing', async () => {
        await mount();
        click(one('instruction-10-agent-1').querySelector('.MuiChip-deleteIcon'));
        expect(one('instruction-unbind-dialog')).toBeTruthy();
        expect(api.unlinkAgentInstruction).not.toHaveBeenCalled();
    });
});

describe('InstructionsTableView — the template row', () => {
    it('waits for BOTH required columns before posting', async () => {
        await mount();
        await editField('instruction-name-input-template', 'brand-new');
        expect(api.createInstruction).not.toHaveBeenCalled();

        await editField('instruction-content-input-template', 'Some binding text.');
        expect(api.createInstruction).toHaveBeenCalledTimes(1);
        expect(api.createInstruction.mock.calls[0][2]).toEqual({
            name: 'brand-new', content: 'Some binding text.', creator_fk: CREATOR,
        });
    });

    it('refuses a name already in the catalog', async () => {
        await mount();
        await editField('instruction-name-input-template', 'bound-rule');
        await editField('instruction-content-input-template', 'Some binding text.');
        expect(api.createInstruction).not.toHaveBeenCalled();
    });
});

describe('InstructionsTableView — the rename advisory reaches the table', () => {
    it('surfaces the notice after renaming a row bound to two or more agents', async () => {
        // `commitField` raises `renameNotice` from the PAGE, but the card renders it
        // inside the row. A grid row has nowhere for an Alert, so without a renderer
        // in the table the advice was raised into state and never shown — then
        // appeared out of context if the user later switched to Cards.
        await mount();
        await editField('instruction-name-input-10', 'renamed-bound-rule');
        expect(api.updateInstruction).toHaveBeenCalledTimes(1);
        expect(one('instruction-rename-warning')).toBeTruthy();
        expect(one('instruction-rename-warning').textContent).toContain('renamed-bound-rule');
    });

    it('stays silent for a row nobody shares', async () => {
        // Row 11 is unbound, so there is nothing to advise about.
        await mount();
        await editField('instruction-name-input-11', 'renamed-lonely-rule');
        expect(one('instruction-rename-warning')).toBeFalsy();
    });
});

describe('InstructionsTableView — the header adapts to the view', () => {
    it('hides the sort gear, because the grid headers are the sort authority', async () => {
        // Two sort UIs on one page that can disagree is a bug generator.
        await mount();
        expect(one('instructions-settings-button')).toBeFalsy();
    });

    it('shows the gear again in Cards view', async () => {
        sessionStorage.setItem('darwin-instructions-view', 'cards');
        localStorage.setItem('darwin-instructions-view', 'cards');
        await mount();
        expect(one('instructions-settings-button')).toBeTruthy();
    });

    it('keeps the accounting line, counting the WHOLE catalog', async () => {
        await mount();
        expect(one('instructions-accounting').textContent)
            .toBe('2 instructions · 1 not bound');
    });
});
