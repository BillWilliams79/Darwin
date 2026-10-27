// @vitest-environment jsdom
//
// Req #3958 — a host that passes `onMoveTrack` is told every frame of a head
// drag where the panel is drawn and whether a release would DOCK it, then once
// how the drag ended; a move frame it answers truthy draws the panel
// translucent. (jsdom has no layout: rects are faked.)

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import AnchoredPanel from '../AnchoredPanel';
import { usePanelRackStore } from '../../../stores/usePanelRackStore';

const LIMITS = { minW: 120, minH: 64, autoMaxW: 420, headPx: 31 };
const COLORS = { frame: '#a64dff', background: '#000', line: '#333', text: '#fff',
    head: '#7bb8de', headHover: '#cfe4f7' };
const HOME = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };

const place = (el, rect) => {
    el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
};
function Panel({ onMoveTrack, dockable }) {
    const [dock, setDock] = useState(HOME);
    return (
        <AnchoredPanel dock={dock} rackId="a" onDockChange={(d) => setDock(d || HOME)}
                       open onToggle={() => {}} name="Panel" testid="p" limits={LIMITS} colors={COLORS}
                       onMoveTrack={onMoveTrack} dockable={dockable}>
            {() => <div>rows</div>}
        </AnchoredPanel>
    );
}
const head = () => screen.getByTestId('p-header');
const press = (at) => fireEvent.pointerDown(head(), { button: 0, pointerId: 1, clientX: at[0], clientY: at[1] });
const moveTo = (at) => fireEvent.pointerMove(head(), { pointerId: 1, clientX: at[0], clientY: at[1] });
const release = (at, end = 'pointerUp') => fireEvent[end](head(), { pointerId: 1, clientX: at[0], clientY: at[1] });

let zone;
describe('AnchoredPanel onMoveTrack (req #3958)', () => {
    beforeEach(() => {
        localStorage.clear();
        usePanelRackStore.setState({ racked: [], slot: null, drag: null, covered: false });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        zone = document.createElement('div');
        zone.setAttribute('data-panel-rack-zone', '');
        place(zone, { left: 0, top: 0, width: 180, height: 1000 });
        const slot = document.createElement('div');
        zone.appendChild(slot);
        document.body.appendChild(zone);
        act(() => usePanelRackStore.getState().setSlot({ node: slot, width: 180 }));
    });
    afterEach(() => { cleanup(); zone.remove(); });

    it('tells every move frame its rect, translucent while the host points at something; a float drop ends it', () => {
        const track = vi.fn(({ phase }) => phase === 'move');
        render(<Panel onMoveTrack={track} />);
        const panel = screen.getByTestId('p');
        place(panel, { left: 1200, top: 800, width: 300, height: 180 });

        press([1300, 810]);
        moveTo([900, 610]);
        expect(track).toHaveBeenLastCalledWith({ phase: 'move', docking: false,
            rect: { left: 800, top: 600, width: 300, height: 180 } });
        expect(panel.style.opacity || getComputedStyle(panel).opacity).toBe('0.6');

        release([900, 610]);
        expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'drop', docking: false }));
        expect(getComputedStyle(panel).opacity).not.toBe('0.6');
    });

    it('over a rack it is docking; dropped there the drop says so', () => {
        const track = vi.fn(() => false);
        render(<Panel onMoveTrack={track} />);
        place(screen.getByTestId('p'), { left: 1200, top: 800, width: 300, height: 180 });
        press([1300, 810]);
        moveTo([90, 400]);
        expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'move', docking: true }));
        release([90, 400]);
        expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'drop', docking: true }));
        expect(screen.getByTestId('p').getAttribute('data-racked')).toBe('1');
    });

    it('a cancelled pointer ends it as a cancel; a press that never moved tells nothing', () => {
        const track = vi.fn(() => true);
        render(<Panel onMoveTrack={track} />);
        place(screen.getByTestId('p'), { left: 1200, top: 800, width: 300, height: 180 });
        press([1300, 810]);
        release([1300, 810]);
        expect(track).not.toHaveBeenCalled();
        press([1300, 810]);
        moveTo([900, 610]);
        release([900, 610], 'pointerCancel');
        expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'cancel' }));
    });

    it('dockable={false}: over the rack it is not docking, and dropped there it floats (the filer\'s picker mode)', () => {
        const track = vi.fn(() => true);
        render(<Panel onMoveTrack={track} dockable={false} />);
        place(screen.getByTestId('p'), { left: 1200, top: 800, width: 300, height: 180 });
        press([1300, 810]);
        moveTo([90, 400]);
        expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'move', docking: false }));
        expect(usePanelRackStore.getState().drag).toMatchObject({ id: 'a', over: false });
        release([90, 400]);
        expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'drop', docking: false }));
        expect(screen.getByTestId('p').getAttribute('data-racked')).toBe('0');
        expect(usePanelRackStore.getState().racked).toEqual([]);
    });
});
