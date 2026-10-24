// @vitest-environment jsdom
//
// Req #3751 — the nav list and the rack share one column that scrolls when the
// nav list alone outgrows the navbar. A drop's "into the stack" test clips the
// stack to that column's visible edges as well as the rack's: a pointer below
// the column's bottom is below the stack, whatever the rack holds out of sight.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { rackTarget } from '../usePanelRack';
import { usePanelRackStore } from '../../../stores/usePanelRackStore';

const box = (el, top, bottom) => {
    el.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top, bottom, height: bottom - top });
    return el;
};
const div = (attrs = {}) => {
    const el = document.createElement('div');
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
};

describe('rackTarget clips the stack to the scrolling column (req #3751)', () => {
    let zone, clip, rack, slot;
    beforeEach(() => {
        zone = box(div({ 'data-panel-rack-zone': '' }), 0, 1000);
        clip = box(div({ 'data-rack-clip': '' }), 50, 500);
        rack = box(div(), 400, 900);
        slot = div();
        slot.appendChild(box(div({ 'data-rack-id': 'b' }), 450, 850));
        rack.appendChild(slot);
        clip.appendChild(rack);
        zone.appendChild(clip);
        document.body.appendChild(zone);
        usePanelRackStore.setState({ racked: ['b'], slot: { node: slot, width: 200 }, drag: null });
    });
    afterEach(() => {
        zone.remove();
        usePanelRackStore.setState({ racked: [], slot: null, drag: null });
    });

    it('a pointer below the column\'s visible bottom lands last', () => {
        // Inside panel b's upper half, but scrolled out of the column's sight.
        expect(rackTarget('a', 100, 600, false)).toEqual({ over: true, rack: 'nav', own: false, index: 1 });
    });

    it('a pointer above the column\'s visible top lands last', () => {
        // The stack scrolled up under the navbar header: above the column is
        // not in the stack.
        clip.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 700, bottom: 1000, height: 300 });
        expect(rackTarget('a', 100, 600, false)).toEqual({ over: true, rack: 'nav', own: false, index: 1 });
    });

    it('a pointer on panel b\'s visible upper half still lands above it', () => {
        clip.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 50, bottom: 1000, height: 950 });
        expect(rackTarget('a', 100, 600, false)).toEqual({ over: true, rack: 'nav', own: false, index: 0 });
    });
});
