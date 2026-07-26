// @vitest-environment jsdom
//
// Req #3067 — the compact (table-cell) variant of the membership control.
//
// The variant exists because a 92px grid row cannot hold an inline palette of
// twelve ghost chips. What must NOT change with it is anything behavioural: one
// chip is still one write, the unbind is still only REQUESTED (the page confirms
// it), and the drill-through still works.
//
// THE DEFECT THIS FILE PRIMARILY GUARDS AGAINST is a testid collision. The first
// design had the compact variant render this component recursively inside its
// Popover, which reads well and puts the bound chips and the toggle in the DOM
// TWICE — duplicating the exact ids the Playwright suite reaches for, so
// `getByTestId` goes strict-mode ambiguous and every membership test fails with a
// message about locators rather than about membership. The shipped design shares
// the chip GROUPS instead. These assertions are counts for that reason; they look
// pedantic and are not.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import InstructionAgentChips from '../InstructionAgentChips';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const AGENTS = [
    { id: 1, name: 'alpha' },
    { id: 2, name: 'beta' },
    { id: 3, name: 'gamma' },
];
const agentIndex = new Map(AGENTS.map(a => [a.id, a]));

// The Popover portals to document.body, so every query is document-wide. Counting
// across the WHOLE document is the point — a duplicate in the portal is exactly the
// bug being guarded against.
const all = (testId) => document.body.querySelectorAll(`[data-testid="${testId}"]`);
const one = (testId) => document.body.querySelector(`[data-testid="${testId}"]`);

const render = (props = {}) => act(() => {
    root.render(
        <InstructionAgentChips
            boundAgentIds={[1]}
            agentIndex={agentIndex}
            bindableAgents={AGENTS.filter(a => a.id !== 1)}
            slotOf={() => 1}
            onBind={() => {}}
            onBindAll={() => {}}
            onRequestUnbind={() => {}}
            onOpenAgent={() => {}}
            testIdPrefix="instruction-10"
            {...props}
        />);
});

const click = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

describe('InstructionAgentChips — compact variant, DOM shape', () => {
    it('shows the bound chips and the toggle, and hides the palette until asked', () => {
        render({ variant: 'compact' });
        expect(one('instruction-10-agent-1')).toBeTruthy();
        expect(one('instruction-10-agent-add')).toBeTruthy();
        expect(one('instruction-10-bind-2')).toBeFalsy();
    });

    it('opens the palette into a Popover, NOT inline', () => {
        render({ variant: 'compact' });
        click(one('instruction-10-agent-add'));
        expect(one('instruction-10-agent-palette')).toBeTruthy();
        expect(one('instruction-10-bind-2')).toBeTruthy();
        expect(one('instruction-10-bind-3')).toBeTruthy();
    });

    it('renders each testid EXACTLY ONCE while the palette is open', () => {
        // The recursion trap. Every one of these would be 2 under the design that
        // rendered the component inside its own Popover.
        render({ variant: 'compact' });
        click(one('instruction-10-agent-add'));

        expect(all('instruction-10-agent-1')).toHaveLength(1);
        expect(all('instruction-10-agent-add')).toHaveLength(1);
        expect(all('instruction-10-bind-2')).toHaveLength(1);
        expect(all('instruction-10-agent-bind-all')).toHaveLength(1);
    });
});

describe('InstructionAgentChips — compact variant, behaviour is unchanged', () => {
    it('binds ONE agent per palette chip click', () => {
        const onBind = vi.fn();
        render({ variant: 'compact', onBind });
        click(one('instruction-10-agent-add'));
        click(one('instruction-10-bind-2'));
        expect(onBind).toHaveBeenCalledTimes(1);
        expect(onBind).toHaveBeenCalledWith(2);
    });

    it('offers bind-all from two remaining upwards, and passes the whole list', () => {
        const onBindAll = vi.fn();
        render({ variant: 'compact', onBindAll });
        click(one('instruction-10-agent-add'));
        click(one('instruction-10-agent-bind-all'));
        expect(onBindAll).toHaveBeenCalledWith(AGENTS.filter(a => a.id !== 1));
    });

    it('withholds bind-all at one remaining agent', () => {
        render({ variant: 'compact', bindableAgents: [AGENTS[1]] });
        click(one('instruction-10-agent-add'));
        expect(one('instruction-10-agent-bind-all')).toBeFalsy();
    });

    it('REQUESTS an unbind rather than performing one, with the slot', () => {
        const onRequestUnbind = vi.fn();
        render({ variant: 'compact', onRequestUnbind, slotOf: () => 4 });
        click(one('instruction-10-agent-1').querySelector('.MuiChip-deleteIcon'));
        expect(onRequestUnbind).toHaveBeenCalledWith(AGENTS[0], 4);
    });

    it('drills through to the agent on a chip body click', () => {
        const onOpenAgent = vi.fn();
        render({ variant: 'compact', onOpenAgent });
        click(one('instruction-10-agent-1'));
        expect(onOpenAgent).toHaveBeenCalledWith(1);
    });

    it('does not REOPEN itself after the anchor has been through an unmount', async () => {
        // The regression, and it is not hypothetical: `paletteOpen` used to be
        // cleared only by the Popover's own onClose. Binding the last agent unmounts
        // the toggle chip — the anchor — while leaving `paletteOpen` true, so the
        // moment an unbind made a bindable agent reappear a NEW toggle mounted, the
        // open condition went true again, and the palette reopened with no user
        // action, anchored to a detached node that MUI clamps to the top-left of the
        // viewport.
        render({ variant: 'compact' });
        click(one('instruction-10-agent-add'));
        expect(one('instruction-10-agent-palette')).toBeTruthy();

        // Everything bound: anchor gone.
        render({ variant: 'compact', bindableAgents: [] });
        await act(async () => { await new Promise(r => setTimeout(r, 600)); });

        // Somebody is unbound again — a bindable agent, and a new toggle chip, are back.
        render({ variant: 'compact', bindableAgents: [AGENTS[1]] });
        expect(one('instruction-10-agent-add')).toBeTruthy();
        expect(one('instruction-10-agent-palette')).toBeFalsy();
        // ...and it still opens on a real click.
        click(one('instruction-10-agent-add'));
        expect(one('instruction-10-agent-palette')).toBeTruthy();
    });

    it('closes the palette when the last bindable agent is taken', async () => {
        // Not cosmetic: the toggle chip IS the Popover's anchor, so leaving it open
        // once the chip unmounts leaves MUI holding a detached anchorEl — which
        // warns and parks the popover at the viewport origin.
        render({ variant: 'compact' });
        click(one('instruction-10-agent-add'));
        expect(one('instruction-10-agent-palette')).toBeTruthy();
        expect(one('instruction-10-agent-add')).toBeTruthy();

        render({ variant: 'compact', bindableAgents: [] });
        // The anchor really is gone — this is the half that makes an open Popover a
        // problem rather than a cosmetic oddity.
        expect(one('instruction-10-agent-add')).toBeFalsy();
        // MUI keeps the Paper mounted through its Grow exit, so wait past the
        // transition rather than asserting on a half-torn-down tree.
        await act(async () => { await new Promise(r => setTimeout(r, 600)); });
        expect(one('instruction-10-agent-palette')).toBeFalsy();
    });
});

describe('InstructionAgentChips — the inline variant is untouched', () => {
    it('still unfurls the palette in place, with no Popover', () => {
        render({});
        click(one('instruction-10-agent-add'));
        expect(one('instruction-10-bind-2')).toBeTruthy();
        expect(one('instruction-10-agent-palette')).toBeFalsy();
    });

    it('keeps the card wording for an unbound row', () => {
        render({ boundAgentIds: [] });
        expect(container.textContent).toContain('No agent loads this yet');
    });

    it('uses the terse wording in a grid row, where there is no space for prose', () => {
        render({ variant: 'compact', boundAgentIds: [] });
        expect(document.body.textContent).toContain('not bound');
    });
});
