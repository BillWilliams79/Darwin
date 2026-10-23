// @vitest-environment jsdom
//
// Req #3792 — AI Architecture's own toolbar (the topology page's navbar, in a
// same-origin iframe) is THE rack while it is drawn: a shadow-root rack below
// its buttons is published as the page slot, racked windows portal into it
// (styled there), the toolbar glows for a drop and the frame lets a carried
// window keep its pointer; folded, the toolbar gives the windows back to the
// Darwin navbar. (jsdom has no layout or ResizeObserver: those are faked.)

import React, { useRef } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

import AnchoredPanel from '../../Components/AnchoredPanel/AnchoredPanel';
import { usePanelRackStore } from '../../stores/usePanelRackStore';
import ToolbarRack from '../ToolbarRack';

const LIMITS = { minW: 120, minH: 64, autoMaxW: 420, headPx: 31 };
const COLORS = { frame: '#a64dff', background: '#000', line: '#333', text: '#fff',
    head: '#7bb8de', headHover: '#cfe4f7' };
const HOME = { h: 'r', x: 16, v: 'b', y: 16, w: null, ht: null };

let frame, navSlot;
function Page() {
    const frameRef = useRef(frame);
    return (
        <>
            <ToolbarRack frameRef={frameRef} />
            <AnchoredPanel dock={HOME} rackId="a" onDockChange={() => {}} open onToggle={() => {}}
                           name="Panel a" testid="p-a" limits={LIMITS} colors={COLORS}>
                {() => <div>rows</div>}
            </AnchoredPanel>
        </>
    );
}
const tick = () => act(() => new Promise(r => setTimeout(r, 0)));
const toolbar = () => frame.contentDocument.querySelector('nav.navbar');
const host = () => frame.contentDocument.querySelector('[data-testid="toolbar-rack-host"]');

describe('ToolbarRack (req #3792)', () => {
    beforeEach(() => {
        localStorage.clear();
        usePanelRackStore.setState({ racked: ['a'], slot: null, navSlot: null, pageSlot: null,
            drag: null, covered: false });
        navSlot = document.createElement('div');
        document.body.appendChild(navSlot);
        act(() => usePanelRackStore.getState().setSlot({ node: navSlot, width: 180 }));
        frame = document.createElement('iframe');
        document.body.appendChild(frame);
        const doc = frame.contentDocument;
        doc.body.innerHTML = '<div class="container"><nav class="navbar"><div class="nav-vendor">'
            + '<button>VR200</button></div></nav><div class="stage"><div class="tpu3d"></div></div></div>';
        frame.contentWindow.ResizeObserver = class { observe() {} disconnect() {} };
    });
    afterEach(() => { cleanup(); frame.remove(); navSlot.remove(); });

    it('racks the info windows below the toolbar\'s buttons, in its own shadow root', () => {
        render(<Page />);
        const h = host();
        expect(h.parentElement).toBe(toolbar());
        expect(h.previousElementSibling.className).toBe('nav-vendor');
        const { slot, pageSlot } = usePanelRackStore.getState();
        expect(slot).toBe(pageSlot);
        expect(h.shadowRoot.contains(slot.node)).toBe(true);
        // The racked window is drawn there, styled by the shadow root's own sheet.
        const panel = screen.queryByTestId('p-a') || h.shadowRoot.querySelector('[data-testid="p-a"]');
        expect(h.shadowRoot.contains(panel)).toBe(true);
        expect(panel.getAttribute('data-racked')).toBe('1');
        expect(h.shadowRoot.querySelector('style[data-emotion^="toolbar-rack"]')).not.toBe(null);
        // The topology page's scripts never see the window's buttons.
        expect(frame.contentDocument.querySelectorAll('nav.navbar button')).toHaveLength(1);
        expect(navSlot.childElementCount).toBe(0);
    });

    it('the zone is the toolbar\'s column, in Darwin\'s px through the frame', () => {
        render(<Page />);
        toolbar().getBoundingClientRect = () => ({ left: 0, right: 200, top: 24, bottom: 400, width: 200, height: 376 });
        frame.getBoundingClientRect = () => ({ left: 180, top: 0, right: 1600, bottom: 1000, width: 1420, height: 1000 });
        const { zone, offset } = usePanelRackStore.getState().pageSlot;
        expect(offset()).toEqual({ left: 180, top: 0 });
        expect(zone.getBoundingClientRect()).toMatchObject({ left: 0, right: 200, top: 24,
            bottom: frame.contentWindow.innerHeight });
    });

    it('glows for a drop over it, and the frame keeps a carried window\'s pointer', () => {
        render(<Page />);
        act(() => usePanelRackStore.getState().setDrag({ id: 'b', over: false, index: null, fromRack: false, color: '#ff6b35' }));
        expect(toolbar().getAttribute('data-rack-drop')).toBe('armed');
        expect(toolbar().style.boxShadow).toBe('');
        expect(frame.style.pointerEvents).toBe('none');
        act(() => usePanelRackStore.getState().setDrag({ id: 'b', over: true, index: 0, fromRack: false, color: '#ff6b35' }));
        expect(toolbar().getAttribute('data-rack-drop')).toBe('over');
        expect(toolbar().style.boxShadow).toContain('#ff6b35');
        act(() => usePanelRackStore.getState().setDrag(null));
        expect(toolbar().getAttribute('data-rack-drop')).toBe('off');
        expect(toolbar().style.boxShadow).toBe('');
        expect(frame.style.pointerEvents).toBe('');
    });

    it('folded or under a full screen, the toolbar gives the windows back to the navbar', async () => {
        render(<Page />);
        toolbar().classList.add('nav-collapsed');
        await tick();
        expect(usePanelRackStore.getState().pageSlot).toBe(null);
        expect(usePanelRackStore.getState().slot.node).toBe(navSlot);
        expect(navSlot.querySelector('[data-testid="p-a"]')).not.toBe(null);
        toolbar().classList.remove('nav-collapsed');
        await tick();
        expect(usePanelRackStore.getState().slot.node).not.toBe(navSlot);
        frame.contentDocument.querySelector('.tpu3d').classList.add('tpu3d-full');
        await tick();
        expect(usePanelRackStore.getState().slot.node).toBe(navSlot);
    });

    it('sits under the buttons as the navbar\'s does: the toolbar gap is cancelled', () => {
        frame.contentDocument.head.innerHTML = '<style>nav.navbar { display: flex; flex-direction: column; row-gap: 14px; }</style>';
        render(<Page />);
        expect(host().style.marginTop).toBe('-14px');
    });

    it('a reload of the frame rebuilds the rack in the new document\'s toolbar', () => {
        render(<Page />);
        const first = usePanelRackStore.getState().pageSlot.node;
        const doc = frame.contentDocument;
        doc.body.innerHTML = '<div class="container"><nav class="navbar"><div class="nav-vendor">'
            + '<button>Chip</button></div></nav></div>';
        act(() => { frame.dispatchEvent(new Event('load')); });
        const h = host();
        expect(h.parentElement).toBe(toolbar());
        const { slot } = usePanelRackStore.getState();
        expect(slot.node).not.toBe(first);
        expect(h.shadowRoot.contains(slot.node)).toBe(true);
        expect(h.shadowRoot.querySelector('[data-testid="p-a"]')).not.toBe(null);
    });

    it('leaving the page removes the rack and withdraws the slot', () => {
        const { unmount } = render(<Page />);
        expect(host()).not.toBe(null);
        unmount();
        expect(host()).toBe(null);
        expect(usePanelRackStore.getState().pageSlot).toBe(null);
        expect(usePanelRackStore.getState().slot.node).toBe(navSlot);
    });
});
