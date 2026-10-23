// @vitest-environment jsdom
//
// req #3648 — the plan toolbar: the "Color"/"View" captions are gone, the order
// is colour | steps-across 6 5 4 | view, Step Width is hidden (code kept),
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
        <PipelinePlanToolbar onStepsAcross={() => {}} stepWidthLevel={5}
                             onChangeStepWidthLevel={() => {}} colorKey="state"
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
    it('draws the steps-across ladder as 6 5 4, between the colour chips and the view group', () => {
        const across = q('pipeline-viz-steps-across');
        expect([...across.querySelectorAll('[data-testid^="pipeline-viz-steps-across-"]')]
            .map((c) => c.textContent)).toEqual(['6', '5', '4']);
        const color = q('pipeline-viz-colorkey-toggle');
        const view = q('pipeline-viz-level-control');
        // eslint-disable-next-line no-bitwise
        expect(color.compareDocumentPosition(across) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // eslint-disable-next-line no-bitwise
        expect(across.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // req #3806 — the Step chip (hover help only) is gone from the title bar.
    it('has no Step chip; the colour chips lead the group', () => {
        const color = q('pipeline-viz-colorkey-toggle');
        expect(q('pipeline-viz-steps-toggle')).toBeNull();
        expect(color.firstElementChild.getAttribute('data-testid')).toMatch(/^pipeline-viz-colorkey-/);
        expect(q('pipeline-viz-colorkey-help-slot')).toBeNull();
        expect(q('pipeline-viz-legend-toggle')).toBeNull();
    });

    it('reports the hovered colour chip, active or not', () => {
        const events = [];
        act(() => root.render(
            <PipelinePlanToolbar onStepsAcross={() => {}} stepWidthLevel={5}
                                 onChangeStepWidthLevel={() => {}} colorKey="state"
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
    // close it, the release is not a click, and the next press anywhere unpins.
    describe('long press pins the colour help (req #3766)', () => {
        let events;
        let picks;
        beforeEach(() => {
            vi.useFakeTimers();
            events = [];
            picks = [];
            act(() => root.render(
                <PipelinePlanToolbar onStepsAcross={() => {}} stepWidthLevel={5}
                                     onChangeStepWidthLevel={() => {}} colorKey="state"
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

        it('unpins on the next press anywhere, falling back to the chip under the pointer', () => {
            const machine = q('pipeline-viz-colorkey-machine');
            const step = q('pipeline-viz-colorkey-state');
            longPress(machine);
            fire(machine, 'mouseout');
            fire(document.body, 'pointerdown');
            expect(events).toEqual(['machine', 'machine*', null]);
            longPress(step);
            fire(step, 'pointerdown');           // pressing the pinned chip itself
            fire(step, 'pointerup');
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

    // req #3686 — the Hide closed chip sits between the colour chips and the ladder.
    it('draws Closed between the colour chips and the steps-across ladder', () => {
        const color = q('pipeline-viz-colorkey-toggle');
        const hide = q('pipeline-viz-hide-closed');
        const across = q('pipeline-viz-steps-across');
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
            <PipelinePlanToolbar onStepsAcross={() => {}} stepWidthLevel={5}
                                 onChangeStepWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} hideClosed={hideClosed}
                                 onChangeHideClosed={(v) => got.push(v)} planLevelPref="auto"
                                 effectiveLevel="out" onChangeLevelPref={() => {}}
                                 onResetView={() => {}} />));
        render(false);
        expect(q('pipeline-viz-hide-closed').getAttribute('aria-pressed')).toBe('false');
        act(() => q('pipeline-viz-hide-closed').click());
        render(true);
        expect(q('pipeline-viz-hide-closed').getAttribute('aria-pressed')).toBe('true');
        act(() => q('pipeline-viz-hide-closed').click());
        expect(got).toEqual([true, false]);
    });

    it('hides the Step Width rungs', () => {
        expect(q('pipeline-viz-stepwidth-toggle')).toBeNull();
    });

    it('a ladder click asks for that many steps across', () => {
        const asked = [];
        act(() => root.render(
            <PipelinePlanToolbar onStepsAcross={(n) => asked.push(n)} stepWidthLevel={5}
                                 onChangeStepWidthLevel={() => {}} colorKey="state"
                                 onChangeColorKey={() => {}} planLevelPref="auto"
                                 effectiveLevel="out" onChangeLevelPref={() => {}}
                                 onResetView={() => {}} />));
        act(() => q('pipeline-viz-steps-across-4').click());
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
            <PipelinePlanToolbar onStepsAcross={() => {}} stepWidthLevel={5}
                                 onChangeStepWidthLevel={() => {}} colorKey="state"
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
            <PipelinePlanToolbar onStepsAcross={() => {}} stepWidthLevel={5}
                                 onChangeStepWidthLevel={() => {}} colorKey="state"
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
