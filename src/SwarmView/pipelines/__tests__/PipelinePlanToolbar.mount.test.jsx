// @vitest-environment jsdom
//
// req #3648 — the plan toolbar: the "Color"/"View" captions are gone, the order
// is colour | view (Default, epics-across 6 5 4, Auto L1 L2 L3), Epic Width is hidden (code kept),
// and Reset reads "Default".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import PipelinePlanToolbar, { RESET_LABEL } from '../PipelinePlanToolbar';
import { LONG_PRESS_MS } from '../../../dnd/pressTimeline';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(
        <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                             onChangeEpicWidthLevel={() => {}} colorKey="state"
                             onChangeColorKey={() => {}} planLevelPref="auto"
                             effectiveLevel="out" onChangeLevelPref={() => {}}
                             onResetView={() => {}} />));
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

const q = (id) => host.querySelector(`[data-testid="${id}"]`);

describe('PipelinePlanToolbar (req #3648)', () => {
    // req #3827 — 6 5 4 joined the view group: Default | 6 5 4 | Auto L1 L2 L3.
    it('draws the epics-across ladder as 6 5 4, inside the view group between Default and Auto', () => {
        const across = q('pipeline-viz-epics-across');
        expect([...across.querySelectorAll('[data-testid^="pipeline-viz-epics-across-"]')]
            .map((c) => c.textContent)).toEqual(['6', '5', '4']);
        const color = q('pipeline-viz-colorkey-toggle');
        const view = q('pipeline-viz-level-control');
        expect(view.contains(across)).toBe(true);
        // eslint-disable-next-line no-bitwise
        expect(color.compareDocumentPosition(across) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // eslint-disable-next-line no-bitwise
        expect(q('pipeline-viz-reset').compareDocumentPosition(across) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // eslint-disable-next-line no-bitwise
        expect(across.compareDocumentPosition(q('pipeline-viz-level-auto')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // req #3827 — branded like the group's other chips: small and outlined.
    it('draws 6 5 4 as small outlined chips like Auto / L1', () => {
        const l1 = q('pipeline-viz-level-1');
        const n = q('pipeline-viz-epics-across-5');
        for (const cls of ['MuiChip-sizeSmall', 'MuiChip-outlined']) {
            expect(n.classList.contains(cls)).toBe(l1.classList.contains(cls));
        }
    });

    // req #3806 — the Epic chip (hover help only) is gone from the title bar.
    it('has no Epic chip; the colour chips lead the group', () => {
        const color = q('pipeline-viz-colorkey-toggle');
        expect(q('pipeline-viz-epics-toggle')).toBeNull();
        expect(color.firstElementChild.getAttribute('data-testid')).toMatch(/^pipeline-viz-colorkey-/);
        expect(q('pipeline-viz-colorkey-help-slot')).toBeNull();
        expect(q('pipeline-viz-legend-toggle')).toBeNull();
    });

    it('reports the hovered colour chip, active or not', () => {
        const events = [];
        act(() => root.render(
            <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                 onChangeEpicWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} planLevelPref="auto"
                                 effectiveLevel="out" onChangeLevelPref={() => {}}
                                 onResetView={() => {}}
                                 onKeyHover={(h) => events.push(h && h.key)} />));
        const enter = (el) => act(() => {
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        });
        const leave = (el) => act(() => {
            el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        });
        enter(q('pipeline-viz-colorkey-machine'));       // not the active scale
        leave(q('pipeline-viz-colorkey-machine'));
        expect(events).toEqual(['machine', null]);
    });

    // req #3766 — a long press on a chip pins its help: hover leaving does not
    // close it and the release is not a click. req #3859 — only Escape or a
    // press on a colour chip unpins it; a press anywhere else leaves it up.
    describe('long press pins the colour help (req #3766)', () => {
        let events;
        let picks;
        beforeEach(() => {
            vi.useFakeTimers();
            events = [];
            picks = [];
            act(() => root.render(
                <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                     onChangeEpicWidthLevel={() => {}} colorKey="state"
                                     onChangeColorKey={(k) => picks.push(k)} planLevelPref="auto"
                                     effectiveLevel="out" onChangeLevelPref={() => {}}
                                     onResetView={() => {}}
                                     onKeyHover={(h) => events.push(h && `${h.key}${h.pinned ? '*' : ''}`)} />));
        });
        afterEach(() => vi.useRealTimers());

        const fire = (el, type, init = {}) => act(() => {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
        });
        const longPress = (el) => {
            fire(el, 'mouseover');
            fire(el, 'pointerdown', { clientX: 10, clientY: 10 });
            act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
            fire(el, 'pointerup', { clientX: 10, clientY: 10 });
            fire(el, 'click');
        };

        it('pins on a long press, survives the pointer leaving, and swallows the release click', () => {
            const chip = q('pipeline-viz-colorkey-machine');
            longPress(chip);
            fire(chip, 'mouseout');
            expect(events).toEqual(['machine', 'machine*']);
            expect(picks).toEqual([]);           // the release did not toggle the scale
        });

        it('stays pinned through presses and clicks anywhere but a colour chip (req #3859)', () => {
            const machine = q('pipeline-viz-colorkey-machine');
            longPress(machine);
            fire(machine, 'mouseout');
            for (const el of [document.body, q('pipeline-viz-reset'), q('pipeline-viz-level-1')]) {
                fire(el, 'pointerdown');
                fire(el, 'pointerup');
                fire(el, 'click');
            }
            fire(document.body, 'pointerdown', { button: 2 });
            expect(events).toEqual(['machine', 'machine*']);
        });

        it('stays pinned when another control re-renders the toolbar', () => {
            longPress(q('pipeline-viz-colorkey-machine'));
            act(() => root.render(
                <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={4}
                                     onChangeEpicWidthLevel={() => {}} colorKey="machine"
                                     onChangeColorKey={() => {}} planLevelPref="2"
                                     effectiveLevel="mid" onChangeLevelPref={() => {}}
                                     onResetView={() => {}} hideClosed
                                     onKeyHover={(h) => events.push(h && `${h.key}${h.pinned ? '*' : ''}`)} />));
            expect(events).toEqual(['machine', 'machine*']);
        });

        it('Enter or Space on a colour chip unpins', () => {
            const machine = q('pipeline-viz-colorkey-machine');
            longPress(machine);
            fire(machine, 'mouseout');
            const state = q('pipeline-viz-colorkey-state');
            act(() => { state.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
            expect(events).toEqual(['machine', 'machine*', null]);
        });

        it('a release off the chip does not swallow a later click', () => {
            const chip = q('pipeline-viz-colorkey-machine');
            fire(chip, 'mouseover');
            fire(chip, 'pointerdown', { clientX: 10, clientY: 10 });
            act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
            fire(document.body, 'pointerup');
            fire(document.body, 'click');
            act(() => { vi.advanceTimersByTime(0); });
            act(() => chip.click());              // no press before it
            expect(picks).toEqual(['machine']);
        });

        it('a right press on a colour chip does not unpin', () => {
            longPress(q('pipeline-viz-colorkey-machine'));
            fire(q('pipeline-viz-colorkey-state'), 'pointerdown', { button: 2 });
            expect(events).toEqual(['machine', 'machine*']);
        });

        it('a press on a colour chip unpins, falling back to the chip under the pointer', () => {
            const machine = q('pipeline-viz-colorkey-machine');
            const epic = q('pipeline-viz-colorkey-state');
            longPress(machine);
            fire(machine, 'mouseout');
            fire(epic, 'pointerdown');
            fire(epic, 'pointerup');
            expect(events).toEqual(['machine', 'machine*', null]);
            longPress(epic);
            fire(epic, 'pointerdown');           // pressing the pinned chip itself
            fire(epic, 'pointerup');
            expect(events.slice(3)).toEqual(['state', 'state*', 'state']);
        });

        it('a click on a colour chip while pinned unpins AND does what the chip does', () => {
            longPress(q('pipeline-viz-colorkey-machine'));
            const state = q('pipeline-viz-colorkey-state');
            fire(state, 'mouseover');
            fire(state, 'pointerdown');
            fire(state, 'pointerup');
            fire(state, 'click');
            expect(events.at(-1)).toBe('state');
            expect(picks).toEqual(['none']);     // 'state' was on, so the click turns it off
        });

        it('Escape unpins', () => {
            const chip = q('pipeline-viz-colorkey-machine');
            longPress(chip);
            fire(chip, 'mouseout');
            act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
            expect(events.at(-1)).toBe(null);
        });

        it('unpins when the pinned chip leaves the page (Lock view)', () => {
            longPress(q('pipeline-viz-colorkey-machine'));
            act(() => root.render(
                <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                     onChangeEpicWidthLevel={() => {}} colorKey="state"
                                     onChangeColorKey={() => {}} planLevelPref="auto"
                                     effectiveLevel="out" onChangeLevelPref={() => {}}
                                     onResetView={() => {}} viewMode="lock"
                                     onKeyHover={(h) => events.push(h && `${h.key}${h.pinned ? '*' : ''}`)} />));
            expect(q('pipeline-viz-colorkey-machine')).toBeNull();
            expect(events).toEqual(['machine', 'machine*', null]);
        });

        it('a short press or a press that moves does not pin', () => {
            const chip = q('pipeline-viz-colorkey-machine');
            fire(chip, 'mouseover');
            fire(chip, 'pointerdown', { clientX: 10, clientY: 10 });
            act(() => { vi.advanceTimersByTime(LONG_PRESS_MS - 50); });
            fire(chip, 'pointerup');
            fire(chip, 'click');
            fire(chip, 'pointerdown', { clientX: 10, clientY: 10 });
            fire(chip, 'pointermove', { clientX: 30, clientY: 10 });
            act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
            expect(events).toEqual(['machine']);
            expect(picks).toEqual(['machine']);
        });
    });

    // req #3686 — the Closed chip sits between the colour chips and the ladder.
    it('draws Closed between the colour chips and the epics-across ladder', () => {
        const color = q('pipeline-viz-colorkey-toggle');
        const hide = q('pipeline-viz-hide-closed');
        const across = q('pipeline-viz-epics-across');
        expect(hide).not.toBeNull();
        expect(hide.textContent).toBe('Closed');
        // eslint-disable-next-line no-bitwise
        expect(color.compareDocumentPosition(hide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // eslint-disable-next-line no-bitwise
        expect(hide.compareDocumentPosition(across) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('Closed toggles: reports the opposite of its current state', () => {
        const got = [];
        const render = (hideClosed) => act(() => root.render(
            <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                 onChangeEpicWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} hideClosed={hideClosed}
                                 onChangeHideClosed={(v) => got.push(v)} planLevelPref="auto"
                                 effectiveLevel="out" onChangeLevelPref={() => {}}
                                 onResetView={() => {}} />));
        // req #3816 — lit (pressed, filled) while closed are SHOWN, like a machine chip.
        render(false);
        expect(q('pipeline-viz-hide-closed').getAttribute('aria-pressed')).toBe('true');
        expect(q('pipeline-viz-hide-closed').getAttribute('aria-label')).toBe('Hide closed requirements');
        act(() => q('pipeline-viz-hide-closed').click());
        render(true);
        expect(q('pipeline-viz-hide-closed').getAttribute('aria-pressed')).toBe('false');
        expect(q('pipeline-viz-hide-closed').getAttribute('aria-label')).toBe('Show closed requirements');
        act(() => q('pipeline-viz-hide-closed').click());
        expect(got).toEqual([true, false]);
    });

    // req #3816 — Closed is drawn exactly like a machine chip: same classes in
    // both states (filled when lit, outlined when not), no size of its own.
    it('Closed looks like a machine chip, lit when shown', () => {
        const machines = [{ id: 7, title: 'Mac Mini' }];
        const render = (hideClosed, hiddenMachines) => act(() => root.render(
            <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                 onChangeEpicWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} hideClosed={hideClosed}
                                 onChangeHideClosed={() => {}} machines={machines}
                                 hiddenMachines={hiddenMachines} onToggleMachine={() => {}}
                                 planLevelPref="auto" effectiveLevel="out"
                                 onChangeLevelPref={() => {}} onResetView={() => {}} />));
        // The emotion class too: identical sx means an identical generated class.
        const classes = (el) => [...el.classList].sort();
        render(false, new Set());
        const closedOn = q('pipeline-viz-hide-closed');
        const machineOn = q('pipeline-viz-machine-7');
        expect(classes(closedOn)).toEqual(classes(machineOn));
        expect(closedOn.classList.contains('MuiChip-filled')).toBe(true);
        render(true, new Set([7]));
        const closedOff = q('pipeline-viz-hide-closed');
        expect(classes(closedOff)).toEqual(classes(q('pipeline-viz-machine-7')));
        expect(closedOff.classList.contains('MuiChip-outlined')).toBe(true);
    });

    // req #3825 — one Time chip, lit while the epic cards draw their times.
    it('draws Time right after Closed, lit when on and dark when off', () => {
        const got = [];
        const render = (showTimes) => act(() => root.render(
            <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                 onChangeEpicWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} hideClosed={false}
                                 onChangeHideClosed={() => {}} showTimes={showTimes}
                                 onChangeShowTimes={(v) => got.push(v)} planLevelPref="auto"
                                 effectiveLevel="out" onChangeLevelPref={() => {}}
                                 onResetView={() => {}} />));
        render(true);
        const time = q('pipeline-viz-show-times');
        expect(time.textContent).toBe('Time');
        // eslint-disable-next-line no-bitwise
        expect(q('pipeline-viz-hide-closed').compareDocumentPosition(time)
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(time.getAttribute('aria-pressed')).toBe('true');
        expect(time.className).not.toMatch(/outlined/i);
        act(() => q('pipeline-viz-show-times').click());
        render(false);
        expect(q('pipeline-viz-show-times').getAttribute('aria-pressed')).toBe('false');
        expect(q('pipeline-viz-show-times').className).toMatch(/outlined/i);
        act(() => q('pipeline-viz-show-times').click());
        expect(got).toEqual([false, true]);
    });

    // req #3825 + #3816 — Time is drawn like Closed: a machine chip's classes.
    it('Time looks like a machine chip in both states', () => {
        const machines = [{ id: 7, title: 'Mac Mini' }];
        const render = (showTimes, hiddenMachines) => act(() => root.render(
            <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                 onChangeEpicWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} hideClosed={false}
                                 onChangeHideClosed={() => {}} showTimes={showTimes}
                                 onChangeShowTimes={() => {}} machines={machines}
                                 hiddenMachines={hiddenMachines} onToggleMachine={() => {}}
                                 planLevelPref="auto" effectiveLevel="out"
                                 onChangeLevelPref={() => {}} onResetView={() => {}} />));
        const classes = (el) => [...el.classList].sort();
        render(true, new Set());
        expect(classes(q('pipeline-viz-show-times'))).toEqual(classes(q('pipeline-viz-machine-7')));
        render(false, new Set([7]));
        expect(classes(q('pipeline-viz-show-times'))).toEqual(classes(q('pipeline-viz-machine-7')));
    });

    it('hides the Epic Width rungs', () => {
        expect(q('pipeline-viz-epicwidth-toggle')).toBeNull();
    });

    it('a ladder click asks for that many epics across', () => {
        const asked = [];
        act(() => root.render(
            <PipelinePlanToolbar onEpicsAcross={(n) => asked.push(n)} epicWidthLevel={5}
                                 onChangeEpicWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} planLevelPref="auto"
                                 effectiveLevel="out" onChangeLevelPref={() => {}}
                                 onResetView={() => {}} />));
        act(() => q('pipeline-viz-epics-across-4').click());
        expect(asked).toEqual([4]);
    });

    it('has no "Color" or "View" caption', () => {
        expect(host.textContent).not.toMatch(/Color:|View|Width:/);
    });

    it('puts the colour chips before the view group', () => {
        const color = q('pipeline-viz-colorkey-toggle');
        const view = q('pipeline-viz-level-control');
        expect(color).not.toBeNull();
        expect(view).not.toBeNull();
        // eslint-disable-next-line no-bitwise
        expect(color.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('labels Reset "Default"', () => {
        expect(q('pipeline-viz-reset').textContent).toBe('Default');
        expect(q('pipeline-viz-reset').getAttribute('aria-label')).toBe(RESET_LABEL);
        expect(RESET_LABEL.startsWith('Default')).toBe(true);
    });

    // req #3708 — the machine filter: one chip per machine, pressed = shown.
    it('draws one machine chip each, pressed unless deselected, and reports the machine id', () => {
        const got = [];
        const machines = [{ id: 2, title: 'Mac Mini', platform: 'darwin' },
            { id: 3, title: 'MCHP Windows', platform: 'wsl' }];
        act(() => root.render(
            <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                 onChangeEpicWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} planLevelPref="auto"
                                 effectiveLevel="out" onChangeLevelPref={() => {}}
                                 onResetView={() => {}} machines={machines}
                                 hiddenMachines={new Set([3])}
                                 onToggleMachine={(id) => got.push(id)} />));
        const mac = q('pipeline-viz-machine-2');
        const win = q('pipeline-viz-machine-3');
        expect(mac.textContent).toBe('Mac Mini');
        expect(win.textContent).toBe('WSL');
        expect(mac.getAttribute('aria-pressed')).toBe('true');
        expect(win.getAttribute('aria-pressed')).toBe('false');
        act(() => win.click());
        act(() => mac.click());
        expect(got).toEqual([3, 2]);
    });

    // req #3806 — Any leads, then this browser's machine, then the rest.
    it('draws a leading Any chip that toggles id 0', () => {
        const got = [];
        const render = (hidden) => act(() => root.render(
            <PipelinePlanToolbar onEpicsAcross={() => {}} epicWidthLevel={5}
                                 onChangeEpicWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} planLevelPref="auto"
                                 effectiveLevel="out" onChangeLevelPref={() => {}}
                                 onResetView={() => {}}
                                 machines={[{ id: 2, title: 'Mac Mini' }]}
                                 hiddenMachines={hidden}
                                 onToggleMachine={(id) => got.push(id)} />));
        render(new Set());
        const chips = [...q('pipeline-viz-machine-filter')
            .querySelectorAll('[data-testid^="pipeline-viz-machine-"]')];
        expect(chips.map((c) => c.textContent)).toEqual(['Any', 'Mac Mini']);
        expect(q('pipeline-viz-machine-0').getAttribute('aria-pressed')).toBe('true');
        act(() => q('pipeline-viz-machine-0').click());
        expect(got).toEqual([0]);
        render(new Set([0]));
        expect(q('pipeline-viz-machine-0').getAttribute('aria-pressed')).toBe('false');
    });

    it('still draws the Any chip when there are no machines', () => {
        expect(q('pipeline-viz-machine-0')).not.toBeNull();
    });
});
