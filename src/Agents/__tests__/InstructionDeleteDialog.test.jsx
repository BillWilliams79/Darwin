// @vitest-environment jsdom
//
// Req #3076 — the WORDING of the instruction delete dialog.
//
// This dialog is the sole guardrail before an `agent_instructions` cascade: a
// hard delete strips the instruction from every agent that bound it, with no
// trace. It deliberately reports TWO different counts, and until this file
// nothing asserted either one or the copy built from them:
//
//   * refCount  = boundAgents.length                      -> DATA destroyed.
//     Every junction row cascades away, closed agent or not.
//   * bootCount = boundAgents.filter(a => !a.closed).length -> RUNTIME impact.
//     Only open agents boot.
//
// Collapsing them would either understate the data loss or overstate what stops
// loading. The branch most likely to be wrong is the one where a row is bound
// ONLY to CLOSED agents — refCount > 0 but bootCount === 0 — because that is the
// most surprising sentence in the component and the one a user is least equipped
// to sanity-check while about to destroy data irreversibly. So the mixed fixture
// keeps the two counts at DIFFERENT numbers on purpose: a version that read
// refCount where it meant bootCount would still pass against equal ones.
//
// Mounted harness with raw react-dom + act — the house pattern (see
// InstructionsPage.test.jsx), because there is no @testing-library in this repo.
// The dialog is a pure presentational component: no contexts, no query client,
// no mocked modules. Every assertion is about rendered text or button state.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import InstructionDeleteDialog from '../InstructionDeleteDialog';

// ---------------------------------------------------------------------------
// Fixtures. `SHARED` is bound to 3 agents of which only 1 is open, so refCount
// (3) and bootCount (1) are distinguishable in the copy.
// ---------------------------------------------------------------------------
const INSTRUCTION = { id: 10, name: 'Bound Rule', content: 'body', closed: 0 };
const CLOSED_INSTRUCTION = { ...INSTRUCTION, closed: 1 };

const OPEN_ONE = [{ name: 'Alpha', closed: 0 }];
const OPEN_TWO = [{ name: 'Alpha', closed: 0 }, { name: 'Bravo', closed: 0 }];
const MIXED = [
    { name: 'Alpha', closed: 0 },
    { name: 'Bravo', closed: 1 },
    { name: 'Charlie', closed: 1 },
];
const ALL_CLOSED = [
    { name: 'Bravo', closed: 1 },
    { name: 'Charlie', closed: 1 },
];

let container;
let root;
let handlers;

beforeEach(() => {
    handlers = {
        onClose: vi.fn(),
        onClose_Instruction: vi.fn(),
        onReopen: vi.fn(),
        onDelete: vi.fn(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

// The dialog renders into a portal on document.body, so every lookup is
// document-wide rather than container-scoped.
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const dialog = () => byTestId('instruction-delete-dialog');
// Collapse whitespace: the copy is authored across JSX lines, so the rendered
// text carries newlines and runs of spaces that no assertion should depend on.
const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const dialogText = () => text(dialog());

const render = (props = {}) => act(() => {
    root.render(
        <InstructionDeleteDialog
            open
            instruction={INSTRUCTION}
            boundAgents={[]}
            {...handlers}
            {...props}
        />
    );
});

const click = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});

// A controlled React input ignores `el.value = x`; the write has to go through
// the native setter so React's change tracking sees it.
const typeInto = (el, value) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        .set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

// ---------------------------------------------------------------------------
// The blast-radius copy — the whole point of the dialog.
// ---------------------------------------------------------------------------
describe('blast radius copy: refCount (data) vs bootCount (runtime)', () => {
    it('reports BOTH counts, and they are different numbers, on a mixed row', () => {
        render({ boundAgents: MIXED });

        // refCount is all 3 bindings — the data that cascades away.
        expect(dialogText()).toContain('This instruction is bound to 3 agents.');
        // bootCount is only the 1 open agent — the runtime impact.
        expect(dialogText()).toContain('1 of them load it at boot today and would silently lose the duty.');
        // The two are not interchangeable: neither count may leak into the
        // other's sentence.
        expect(dialogText()).not.toContain('bound to 1 agent');
        expect(dialogText()).not.toContain('3 of them load it at boot');
    });

    it('singularises the binding count at exactly one agent', () => {
        render({ boundAgents: OPEN_ONE });
        expect(dialogText()).toContain('This instruction is bound to 1 agent.');
        expect(dialogText()).not.toContain('1 agents');
    });

    // THE branch req #3076 was raised for: bound only to closed agents. Nothing
    // stops loading today, yet the data is still destroyed — and the loss only
    // surfaces later, when someone reopens an agent and the duty is gone.
    it('when every bound agent is CLOSED, says nothing changes at boot but the duty is lost on reopen', () => {
        render({ boundAgents: ALL_CLOSED });

        expect(dialogText()).toContain('This instruction is bound to 2 agents.');
        expect(dialogText()).toContain(
            'None of them are open, so nothing changes at boot — but reopening any of them would silently lose the duty.'
        );
        // The open-agent sentence must NOT appear — claiming "0 of them load it
        // at boot today" would be the collapsed-count bug this branch exists to
        // prevent.
        expect(dialogText()).not.toContain('load it at boot today');
    });

    it('an unbound row says the delete affects nothing, and shows no blast radius', () => {
        render({ boundAgents: [] });

        expect(dialogText()).toContain(
            'No agent is bound to this instruction, so deleting it affects nothing at boot.'
        );
        expect(dialogText()).not.toContain('bound to 0 agents');
        expect(dialogText()).not.toContain('cascade away');
    });

    it('lists every bound agent, marking the closed ones', () => {
        render({ boundAgents: MIXED });
        const chips = dialogText();

        // All three appear — the data loss covers closed agents too.
        expect(chips).toContain('Alpha');
        expect(chips).toContain('Bravo (closed)');
        expect(chips).toContain('Charlie (closed)');
        // The open one is not mislabelled.
        expect(chips).not.toContain('Alpha (closed)');
    });
});

// ---------------------------------------------------------------------------
// The typed-name challenge. Deliberately reserved for SHARED rows so people are
// not trained to type past it on every delete.
// ---------------------------------------------------------------------------
describe('typed-name challenge', () => {
    it('does not appear for a single binding, and Delete is enabled immediately', () => {
        render({ boundAgents: OPEN_ONE });

        expect(byTestId('instruction-delete-challenge-input')).toBeNull();
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(false);
    });

    it('does not appear for an unbound row either', () => {
        render({ boundAgents: [] });

        expect(byTestId('instruction-delete-challenge-input')).toBeNull();
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(false);
    });

    it('appears at two bindings and holds Delete disabled until the name matches exactly', () => {
        render({ boundAgents: OPEN_TWO });

        const input = byTestId('instruction-delete-challenge-input');
        expect(input).not.toBeNull();
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(true);

        // A prefix of the name is not the name.
        typeInto(input, 'Bound');
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(true);

        // Neither is a near miss with the wrong case.
        typeInto(input, 'bound rule');
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(true);

        typeInto(input, 'Bound Rule');
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(false);

        // Surrounding whitespace is forgiven — it is a typing artefact, not a
        // different answer — but the name itself still has to be right.
        typeInto(input, '  Bound Rule  ');
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(false);

        // And backing out re-arms the guard.
        typeInto(input, 'Bound Rul');
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(true);
    });

    it('fires onDelete only once the challenge is satisfied', () => {
        render({ boundAgents: OPEN_TWO });

        click(byTestId('instruction-delete-confirm-btn'));
        expect(handlers.onDelete).not.toHaveBeenCalled();

        typeInto(byTestId('instruction-delete-challenge-input'), 'Bound Rule');
        click(byTestId('instruction-delete-confirm-btn'));
        expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    });

    it('clears a satisfied challenge when the dialog reopens on another row', () => {
        render({ boundAgents: OPEN_TWO });
        typeInto(byTestId('instruction-delete-challenge-input'), 'Bound Rule');
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(false);

        // Same open dialog, different instruction: the typed value must not
        // carry over and pre-authorise a delete of a row the user never typed.
        render({
            boundAgents: OPEN_TWO,
            instruction: { id: 11, name: 'Other Rule', content: 'body', closed: 0 },
        });
        expect(byTestId('instruction-delete-challenge-input').value).toBe('');
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Title and Close-button copy. A menu item labelled "Close instruction…" that
// opens a dialog titled "Delete …?" is a lie about what is about to happen.
// ---------------------------------------------------------------------------
describe('intent', () => {
    it('titles the dialog for deletion by default and offers "Close instead"', () => {
        render({ boundAgents: MIXED });

        expect(dialogText()).toContain('Delete “Bound Rule”?');
        expect(text(byTestId('instruction-delete-close-btn'))).toBe('Close instead');
    });

    it('titles the dialog for closing when opened with intent="close"', () => {
        render({ boundAgents: MIXED, intent: 'close' });

        expect(dialogText()).toContain('Close “Bound Rule”?');
        expect(dialogText()).not.toContain('Delete “Bound Rule”?');
        // Arriving from the Close menu item, closing IS the requested action —
        // "instead" would be nonsense.
        expect(text(byTestId('instruction-delete-close-btn'))).toBe('Close');
    });

    it('drops "instead" on an unbound row, where there is no blast radius to steer away from', () => {
        render({ boundAgents: [] });
        expect(text(byTestId('instruction-delete-close-btn'))).toBe('Close');
    });

    it('still shows the blast radius under intent="close" — closing unloads it too', () => {
        render({ boundAgents: MIXED, intent: 'close' });
        expect(dialogText()).toContain('This instruction is bound to 3 agents.');
    });
});

// ---------------------------------------------------------------------------
// The closed-row Reopen path (req #3063).
// ---------------------------------------------------------------------------
describe('closed instruction', () => {
    it('offers Reopen instead of Close, and titles the dialog for both outcomes', () => {
        render({ instruction: CLOSED_INSTRUCTION, boundAgents: MIXED });

        expect(dialogText()).toContain('Reopen or delete “Bound Rule”?');
        expect(byTestId('instruction-delete-close-btn')).toBeNull();

        click(byTestId('instruction-delete-reopen-btn'));
        expect(handlers.onReopen).toHaveBeenCalledTimes(1);
        expect(handlers.onClose_Instruction).not.toHaveBeenCalled();
    });

    it('explains what reopening restores, counted in OPEN bound agents', () => {
        render({ instruction: CLOSED_INSTRUCTION, boundAgents: MIXED });

        const note = text(byTestId('instruction-delete-closed-note'));
        expect(note).toContain('This instruction is closed, so it drops out of every boot payload today.');
        // bootCount, not refCount: only the 1 open agent boots it back.
        expect(note).toContain('restores the duty for 1 open agent at their next boot');
        expect(note).not.toContain('3 open agents');
    });

    it('falls back to indefinite phrasing when no bound agent is open', () => {
        render({ instruction: CLOSED_INSTRUCTION, boundAgents: ALL_CLOSED });

        const note = text(byTestId('instruction-delete-closed-note'));
        // "0 open agents" would be both awkward and misleading — the bindings
        // still exist and still matter.
        expect(note).toContain('restores the duty for any agent bound to it at their next boot');
        expect(note).not.toContain('0 open');
    });

    it('shows no closed note on an open instruction', () => {
        render({ boundAgents: MIXED });
        expect(byTestId('instruction-delete-closed-note')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// In-flight state.
// ---------------------------------------------------------------------------
describe('busy', () => {
    it('disables every action and labels the delete button as working', () => {
        render({ boundAgents: OPEN_ONE, busy: true });

        expect(byTestId('instruction-delete-cancel-btn').disabled).toBe(true);
        expect(byTestId('instruction-delete-close-btn').disabled).toBe(true);
        const del = byTestId('instruction-delete-confirm-btn');
        expect(del.disabled).toBe(true);
        expect(text(del)).toBe('Working…');
    });

    it('keeps Delete disabled while busy even with the challenge satisfied', () => {
        render({ boundAgents: OPEN_TWO });
        typeInto(byTestId('instruction-delete-challenge-input'), 'Bound Rule');
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(false);

        render({ boundAgents: OPEN_TWO, busy: true });
        expect(byTestId('instruction-delete-confirm-btn').disabled).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Guards.
// ---------------------------------------------------------------------------
describe('guards', () => {
    it('renders nothing without an instruction', () => {
        act(() => {
            root.render(
                <InstructionDeleteDialog open instruction={null} {...handlers} />
            );
        });
        // Nothing at all, not merely no dialog: the caller renders this
        // unconditionally while its selected row is still resolving, so an
        // empty placeholder would flash into the layout on every open.
        expect(dialog()).toBeNull();
        expect(container.innerHTML).toBe('');
    });

    it('Cancel reports back without touching either mutation path', () => {
        render({ boundAgents: MIXED });
        click(byTestId('instruction-delete-cancel-btn'));

        expect(handlers.onClose).toHaveBeenCalledTimes(1);
        expect(handlers.onDelete).not.toHaveBeenCalled();
        expect(handlers.onClose_Instruction).not.toHaveBeenCalled();
    });
});
