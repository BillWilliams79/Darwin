// @vitest-environment jsdom
//
// req #3648 — the plan toolbar: the "Color"/"View" captions are gone, the order
// is colour | steps-across 6 5 4 3 | view, Step Width is hidden (code kept),
// and Reset reads "Default".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import PipelinePlanToolbar, { RESET_LABEL } from '../PipelinePlanToolbar';

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
    it('draws the steps-across ladder as 10 6 5 4 3, between the colour chips and the view group', () => {
        const across = q('pipeline-viz-steps-across');
        expect([...across.querySelectorAll('[data-testid^="pipeline-viz-steps-across-"]')]
            .map((c) => c.textContent)).toEqual(['10', '6', '5', '4', '3']);
        const color = q('pipeline-viz-colorkey-toggle');
        const view = q('pipeline-viz-level-control');
        // eslint-disable-next-line no-bitwise
        expect(color.compareDocumentPosition(across) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // eslint-disable-next-line no-bitwise
        expect(across.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // req #3686 — the Hide closed chip sits between the colour chips and the ladder.
    it('draws Hide closed between the colour chips and the steps-across ladder', () => {
        const color = q('pipeline-viz-colorkey-toggle');
        const hide = q('pipeline-viz-hide-closed');
        const across = q('pipeline-viz-steps-across');
        expect(hide).not.toBeNull();
        // eslint-disable-next-line no-bitwise
        expect(color.compareDocumentPosition(hide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // eslint-disable-next-line no-bitwise
        expect(hide.compareDocumentPosition(across) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('Hide closed toggles: reports the opposite of its current state', () => {
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
        const machines = [{ id: 2, title: 'Mac Mini' }, { id: 3, title: 'MCHP Windows' }];
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
        expect(win.textContent).toBe('MCHP Windows');
        expect(mac.getAttribute('aria-pressed')).toBe('true');
        expect(win.getAttribute('aria-pressed')).toBe('false');
        act(() => win.click());
        act(() => mac.click());
        expect(got).toEqual([3, 2]);
    });

    // Follow-up: Any is a chip of its own, last, pressed unless 0 is deselected.
    it('draws a trailing Any chip that toggles id 0', () => {
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
        expect(chips.map((c) => c.textContent)).toEqual(['Mac Mini', 'Any']);
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
