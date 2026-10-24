// @vitest-environment jsdom
//
// Req #3792 — a page's own toolbar as a rack, and req #3886 — BESIDE the
// navbar's, not over it: while a page publishes its toolbar (`pageSlot`) both
// are drop zones, each keeps the windows dropped on it, and a window is drawn
// in its own rack. The toolbar's drop zone and its document's offset in
// Darwin's viewport decide its hit test, and a window racked there (in another
// document's px) is dragged out in Darwin's px, lifted into Darwin's page for
// the drag and followed on both documents.
// (jsdom has no layout: rects are faked.)

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import AnchoredPanel from '../AnchoredPanel';
import { rackTarget } from '../usePanelRack';
import { rackPlacement, usePanelRackStore } from '../../../stores/usePanelRackStore';

const LIMITS = { minW: 120, minH: 64, autoMaxW: 420, headPx: 31 };
const COLORS = { frame: '#a64dff', background: '#000', line: '#333', text: '#fff',
    head: '#7bb8de', headHover: '#cfe4f7' };
const HOME = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };
/** The page toolbar's document starts this far right in Darwin's viewport. */
const OFF = { left: 300, top: 0 };

const place = (el, rect) => {
    el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width,
        bottom: rect.top + rect.height });
};
const docks = [];
function Panel() {
    const [dock, setDock] = useState(HOME);
    return (
        <AnchoredPanel dock={dock} rackId="a"
                       onDockChange={(d) => { docks.push(d); setDock(d || HOME); }}
                       open onToggle={() => {}} name="Panel a" testid="p-a"
                       limits={LIMITS} colors={COLORS}>
            {() => <div>rows</div>}
        </AnchoredPanel>
    );
}

let navZone, navSlot, frame, toolbar, pageSlot;
const div = (attrs = {}, doc = document) => {
    const el = doc.createElement('div');
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
};
const head = () => screen.getByTestId('p-a-header');
const pointer = (type, at) => fireEvent[type](head(), { button: 0, pointerId: 1, clientX: at[0], clientY: at[1] });

describe('a page toolbar rack (req #3792)', () => {
    beforeEach(() => {
        docks.length = 0;
        localStorage.clear();
        usePanelRackStore.setState({ racked: [], pageRacked: [], slot: null, pageSlot: null,
            drag: null, covered: false });
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1600, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 1000, configurable: true });
        // The Darwin navbar, 0–180.
        navZone = div({ 'data-panel-rack-zone': '' });
        place(navZone, { left: 0, top: 0, width: 180, height: 1000 });
        navSlot = div({ 'data-testid': 'nav-slot' });
        navZone.appendChild(navSlot);
        // The page's toolbar: 0–200 in ITS document (an iframe), which sits at OFF.
        frame = document.createElement('iframe');
        document.body.append(navZone, frame);
        const doc = frame.contentDocument;
        toolbar = div({}, doc);
        place(toolbar, { left: 0, top: 0, width: 200, height: 1000 });
        const rack = div({}, doc);
        pageSlot = div({ 'data-testid': 'page-slot' }, doc);
        rack.appendChild(pageSlot);
        toolbar.appendChild(rack);
        doc.body.appendChild(toolbar);
        act(() => usePanelRackStore.getState().setSlot({ node: navSlot, width: 180 }));
    });
    afterEach(() => { cleanup(); navZone.remove(); frame.remove(); });

    const publishPage = () => act(() => usePanelRackStore.getState().setPageSlot(
        { node: pageSlot, width: 200, zone: toolbar, offset: () => OFF, name: 'toolbar' }));

    it('each window is drawn in its own rack; a toolbar\'s falls back to the navbar with no toolbar (req #3886)', () => {
        const s = usePanelRackStore.getState;
        act(() => { s().rack('n', 0, 'nav'); s().rack('t', 0, 'page'); });
        // No toolbar on the page: the toolbar's window is drawn in the navbar,
        // after the navbar's own, and stays the toolbar's.
        expect(rackPlacement(s(), 'n')).toEqual({ where: 'nav', slot: s().slot, pos: 0 });
        expect(rackPlacement(s(), 't')).toMatchObject({ where: 'nav', pos: 1, fallback: true });
        publishPage();
        // The toolbar drawn: the navbar's window stays in the navbar.
        expect(rackPlacement(s(), 'n').slot.node).toBe(navSlot);
        expect(rackPlacement(s(), 't')).toEqual({ where: 'page', slot: s().pageSlot, pos: 0 });
        // The navbar re-publishing (a width change) changes nothing for the toolbar's.
        act(() => s().setSlot({ node: navSlot, width: 56 }));
        expect(rackPlacement(s(), 't').slot.node).toBe(pageSlot);
        act(() => s().setPageSlot(null));
        expect(rackPlacement(s(), 't').slot.node).toBe(navSlot);
        expect(s().pageRacked).toEqual(['t']);
        // Racked in one, it leaves the other.
        act(() => s().rack('t', 0, 'nav'));
        expect([s().racked, s().pageRacked]).toEqual([['t', 'n'], []]);
        expect(rackPlacement(s(), 'x')).toBe(null);
    });

    it('hit-tests the toolbar\'s zone in Darwin\'s px, and the navbar\'s beside it (req #3886)', () => {
        publishPage();
        // Over the navbar: still a drop zone.
        expect(rackTarget('a', 90, 400, false)).toEqual({ over: true, rack: 'nav', own: false, index: 0 });
        // Left of the toolbar's own px, but inside it once offset.
        expect(rackTarget('a', 350, 400, false)).toEqual({ over: true, rack: 'page', own: false, index: 0 });
        expect(rackTarget('a', 550, 400, false)).toEqual({ over: false, rack: null, own: false, index: null });
    });

    it('drops into the toolbar\'s slot, and drags out of it in Darwin\'s px', () => {
        publishPage();
        render(<Panel />);
        place(screen.getByTestId('p-a'), { left: 1200, top: 800, width: 300, height: 180 });
        pointer('pointerDown', [1300, 810]);
        pointer('pointerMove', [350, 400]);
        expect(usePanelRackStore.getState().drag).toMatchObject({ id: 'a', over: true });
        pointer('pointerUp', [350, 400]);
        expect(usePanelRackStore.getState().pageRacked).toEqual(['a']);
        expect(usePanelRackStore.getState().racked).toEqual([]);
        const inSlot = () => pageSlot.querySelector('[data-testid="p-a"]');
        const racked = inSlot();
        expect(racked).not.toBe(null);
        expect(racked.getAttribute('data-racked')).toBe('1');
        expect(racked.querySelector('[data-testid="p-a-header"]').title).toContain('drag off the toolbar');

        // Racked, its pointer and rect are in the toolbar document's px.
        place(racked, { left: 0, top: 300, width: 200, height: 100 });
        const rHead = racked.querySelector('[data-testid="p-a-header"]');
        const body = racked.querySelector('[data-testid="p-a-body"]');
        body.scrollTop = 40;
        fireEvent.scroll(body);
        fireEvent.pointerDown(rHead, { button: 0, pointerId: 1, clientX: 50, clientY: 310 });   // Darwin's (350, 310)
        // Dragged within the toolbar (a reorder), it stays there, drawn in its px.
        fireEvent.pointerMove(frame.contentDocument, { pointerId: 1, buttons: 1, clientX: 50, clientY: 500 });
        expect(inSlot()).not.toBe(null);
        expect(inSlot().style.left).toBe('0px');
        expect(inSlot().style.top).toBe('490px');
        expect(usePanelRackStore.getState().drag).toMatchObject({ id: 'a', over: true, fromRack: true });
        // Off the toolbar, followed on its document…
        fireEvent.pointerMove(frame.contentDocument, { pointerId: 1, buttons: 1, clientX: 900, clientY: 500 });   // Darwin's (1200, 500)
        // …and lifted into Darwin's page, drawn in Darwin's px.
        expect(inSlot()).toBe(null);
        const lifted = screen.getByTestId('p-a');
        // Remounted in Darwin's page, its rows keep their scroll position.
        expect(screen.getByTestId('p-a-body').scrollTop).toBe(40);
        expect(lifted.style.left).toBe('1150px');
        expect(lifted.style.top).toBe('490px');
        expect(lifted.style.position || getComputedStyle(lifted).position).toBe('fixed');
        expect(usePanelRackStore.getState().drag).toMatchObject({ id: 'a', over: false, fromRack: true });
        // …and on Darwin's own document, unoffset.
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 1200, clientY: 500 });
        expect(usePanelRackStore.getState().pageRacked).toEqual([]);
        expect(inSlot()).toBe(null);
        // Floats where it was dropped — pinned at Darwin's px, not the toolbar's.
        expect(docks[0]).toMatchObject({ h: 'l', x: 1150, v: 't', y: 490 });
        // The gesture is over: a stray pointer on either document moves nothing.
        const n = docks.length;
        fireEvent.pointerMove(frame.contentDocument, { pointerId: 1, buttons: 1, clientX: 100, clientY: 100 });
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 100, clientY: 100 });
        expect(docks).toHaveLength(n);
        expect(usePanelRackStore.getState().drag).toBe(null);
    });

    it('a drag out of the toolbar whose release never arrived ends as a cancel', () => {
        publishPage();
        usePanelRackStore.setState({ pageRacked: ['a'] });
        render(<Panel />);
        const racked = pageSlot.querySelector('[data-testid="p-a"]');
        place(racked, { left: 0, top: 300, width: 200, height: 100 });
        fireEvent.pointerDown(racked.querySelector('[data-testid="p-a-header"]'),
            { button: 0, pointerId: 1, clientX: 50, clientY: 310 });
        fireEvent.pointerMove(frame.contentDocument, { pointerId: 1, buttons: 1, clientX: 900, clientY: 500 });
        expect(pageSlot.querySelector('[data-testid="p-a"]')).toBe(null);
        // Buttons up, no pointerup: cancelled — back in the rack, nothing docked.
        fireEvent.pointerMove(document, { pointerId: 1, buttons: 0, clientX: 1000, clientY: 500 });
        expect(usePanelRackStore.getState().drag).toBe(null);
        expect(usePanelRackStore.getState().pageRacked).toEqual(['a']);
        expect(pageSlot.querySelector('[data-testid="p-a"]')).not.toBe(null);
        expect(docks).toEqual([]);
    });

    it('dragged from the toolbar onto the navbar it moves there, lifted into Darwin\'s page on the way (req #3886)', () => {
        publishPage();
        usePanelRackStore.setState({ pageRacked: ['a'] });
        render(<Panel />);
        const racked = pageSlot.querySelector('[data-testid="p-a"]');
        place(racked, { left: 0, top: 300, width: 200, height: 100 });
        fireEvent.pointerDown(racked.querySelector('[data-testid="p-a-header"]'),
            { button: 0, pointerId: 1, clientX: 50, clientY: 310 });
        // Over the Darwin navbar (Darwin's (90, 500)): not its own rack, so lifted.
        fireEvent.pointerMove(document, { pointerId: 1, buttons: 1, clientX: 90, clientY: 500 });
        expect(pageSlot.querySelector('[data-testid="p-a"]')).toBe(null);
        expect(usePanelRackStore.getState().drag).toMatchObject({ id: 'a', over: true, rack: 'nav', from: 'page' });
        fireEvent.pointerUp(document, { pointerId: 1, clientX: 90, clientY: 500 });
        expect([usePanelRackStore.getState().racked, usePanelRackStore.getState().pageRacked]).toEqual([['a'], []]);
        expect(navSlot.querySelector('[data-testid="p-a"]')).not.toBe(null);
        expect(docks).toEqual([]);
    });

    it('dragged from the navbar onto the toolbar it moves there (req #3886)', () => {
        publishPage();
        usePanelRackStore.setState({ racked: ['a'] });
        render(<Panel />);
        const racked = navSlot.querySelector('[data-testid="p-a"]');
        expect(racked).not.toBe(null);
        place(racked, { left: 0, top: 300, width: 180, height: 100 });
        pointer('pointerDown', [50, 310]);
        pointer('pointerMove', [350, 500]);
        expect(usePanelRackStore.getState().drag).toMatchObject({ id: 'a', over: true, rack: 'page', from: 'nav' });
        pointer('pointerUp', [350, 500]);
        expect([usePanelRackStore.getState().racked, usePanelRackStore.getState().pageRacked]).toEqual([[], ['a']]);
        expect(pageSlot.querySelector('[data-testid="p-a"]')).not.toBe(null);
    });
});
