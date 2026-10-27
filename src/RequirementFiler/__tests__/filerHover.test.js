// @vitest-environment jsdom
//
// req #3958 — the Requirement Filer, pinned, dragged over the page outlines the
// element under its centre (never a bar); unpinned, its + records no place.

import { describe, it, expect, beforeEach } from 'vitest';

import { POINTED_AT_REASONS, captureFiledFrom, pointedAtNow, probeAt } from '../filedFromContext';
import { aimAt, clearAim, showAim } from '../filerHover';

// jsdom lays nothing out: each element's rect is given, and elementsFromPoint
// answers from those rects, topmost (last placed) first.
const rects = new Map();
const place = (el, x, y, w, h) => {
    rects.set(el, { x, y, w, h });
    el.getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
    return el;
};
const $ = (sel) => document.querySelector(sel);
const rect = (left, top, width, height) => ({ left, top, width, height });

function page() {
    document.body.innerHTML = `
        <div data-panel-rack-zone="" data-testid="navbar-rack-zone"><a>Swarm</a></div>
        <div data-title-bar="" data-testid="viewer-header"><span>Plan</span></div>
        <div data-testid="category-card-862">
          <div data-testid="requirement-3958"><span>3958</span> Requirement editor highlights its hover</div>
        </div>
        <div role="toolbar" data-testid="tools"><button>Zoom</button></div>
        <div data-rack-id="requirement-filer" data-testid="requirement-filer"><span>Create</span></div>`;
    place($('[data-panel-rack-zone]'), 0, 0, 180, 1000);
    place($('[data-panel-rack-zone] a'), 10, 10, 100, 20);
    place($('[data-title-bar]'), 180, 0, 1400, 40);
    place($('[data-title-bar] span'), 200, 10, 40, 20);
    place($('[data-testid="category-card-862"]'), 200, 100, 600, 400);
    place($('[data-testid="requirement-3958"]'), 210, 150, 580, 40);
    place($('[data-testid="tools"]'), 900, 100, 300, 40);
    place($('[data-testid="tools"] button'), 910, 105, 60, 30);
}

describe('what the filer flies over (req #3958)', () => {
    beforeEach(() => {
        rects.clear();
        clearAim();
        document.elementsFromPoint = (px, py) => [...rects.entries()]
            .filter(([, r]) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)
            .map(([el]) => el).reverse();
        page();
    });

    it('names the element under its centre, skipping the popup itself', () => {
        // The filer sits over the requirement row: its centre is at (500, 170).
        place($('[data-rack-id]'), 300, 120, 400, 100);
        const target = aimAt(rect(300, 120, 400, 100));
        expect(target.name).toBe('requirement-3958');
        expect(target.rect).toEqual({ left: 210, top: 150, width: 580, height: 40 });
        expect(target.el.getAttribute('data-testid')).toBe('requirement-3958');
    });

    it('PICKER MODE WORKS IN THE BARS (user, 2026-10-27): the navbar, the title bar, a toolbar — nothing is nothing', () => {
        expect(aimAt(rect(40, 0, 100, 40)).name).toBe('navbar-rack-zone');   // the navbar's link
        expect(aimAt(rect(170, 0, 100, 40)).name).toBe('viewer-header');     // the title bar's text
        expect(aimAt(rect(890, 100, 100, 40)).name).toBe('tools');           // a toolbar's button
        expect(aimAt(rect(1300, 800, 100, 40))).toBeNull();                  // nothing
        expect(probeAt(document, 220, 20).hit.tagName).toBe('SPAN');
        // Docked in the title bar it points at nothing; floating over the bar it points at the bar.
        expect(pointedAtNow({ id: 'requirement-filer', racked: false, titleLocked: true, rect: { x: 300, y: 0, w: 100, h: 40 } }))
            .toEqual({ pointedAt: null, pointedAtReason: POINTED_AT_REASONS.titleLocked });
        expect(pointedAtNow({ id: 'requirement-filer', racked: false, rect: { x: 300, y: 0, w: 100, h: 40 } })
            .pointedAt[0].testidPath).toEqual(['viewer-header']);
    });

    it('looks into a frame whose pointer is off mid-drag — its toolbar included', () => {
        document.body.innerHTML = '<div data-testid="systems-page"><iframe data-testid="topology-frame"></iframe></div>';
        rects.clear();
        place($('[data-testid="systems-page"]'), 0, 0, 1600, 1000);
        const frame = $('iframe');
        // pointer-events off: elementsFromPoint never answers the iframe itself.
        frame.getBoundingClientRect = () => ({ left: 200, top: 0, width: 1400, height: 1000, right: 1600, bottom: 1000 });
        const fdoc = frame.contentDocument;
        fdoc.body.innerHTML = '<nav class="navbar"><button>Views</button></nav><div data-testid="stage-node">GPU 3</div>';
        const inner = new Map([[fdoc.querySelector('nav'), { x: 0, y: 0, w: 200, h: 1000 }],
            [fdoc.querySelector('[data-testid="stage-node"]'), { x: 400, y: 300, w: 100, h: 50 }]]);
        for (const [el, r] of inner) el.getBoundingClientRect = () => ({ left: r.x, top: r.y, width: r.w, height: r.h, right: r.x + r.w, bottom: r.y + r.h });
        fdoc.elementsFromPoint = (px, py) => [...inner.entries()]
            .filter(([, r]) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h).map(([el]) => el);
        const target = aimAt(rect(550, 240, 200, 200));     // centre (650, 340) → frame (450, 340)
        expect(target.name).toBe('stage-node');
        expect(target.rect).toEqual({ left: 600, top: 300, width: 100, height: 50 });
        expect(target.frame.label).toBe('topology-frame');
        expect(aimAt(rect(250, 250, 100, 100)).name).toBe('nav');   // the topology toolbar
    });

    it('outlines it with a chip naming it, above every popup, taking no pointer; null clears it', () => {
        place($('[data-rack-id]'), 300, 120, 400, 100);
        showAim(aimAt(rect(300, 120, 400, 100)), 'not recorded');
        const o = $('[data-testid="requirement-aim"]');
        expect(o.style.pointerEvents).toBe('none');
        expect(Number(o.style.zIndex)).toBeGreaterThan(1250);
        expect([o.style.left, o.style.top, o.style.width, o.style.height]).toEqual(['210px', '150px', '580px', '40px']);
        expect($('[data-testid="requirement-aim-name"]').textContent).toBe('requirement-3958 · not recorded');
        showAim(null);
        expect($('[data-testid="requirement-aim"]')).toBeNull();
    });
});

describe('the pushpin decides whether the + records the place (req #3958)', () => {
    beforeEach(() => {
        rects.clear();
        document.elementsFromPoint = (px, py) => [...rects.entries()]
            .filter(([, r]) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)
            .map(([el]) => el).reverse();
        page();
        place($('[data-rack-id]'), 300, 120, 400, 100);
    });
    const at = (pinned) => captureFiledFrom({ location: { pathname: '/swarm', search: '', hash: '' }, profile: null,
        database: 'darwin_dev', theme: null, popupId: 'requirement-filer', popupStore: { open: true, dock: null }, pinned });

    it('pinned, the place it sits over is recorded; unpinned, nothing — and the reason', () => {
        const yes = at(true);
        expect(yes.pointedAt[0].testidPath[0]).toBe('requirement-3958');
        expect(yes.popup.pinned).toBe(true);
        const no = at(false);
        expect(no.pointedAt).toBeNull();
        expect(no.pointedAtReason).toBe(POINTED_AT_REASONS.notPinned);
        expect(no.popup.pinned).toBe(false);
    });
});
