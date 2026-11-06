// @vitest-environment jsdom
//
// req #4197 — the Requirement Filer's + can be dragged: past a few px it is a
// drag (a blue + is the pointer, the element under it outlined), a drop files
// with that place — pin pressed or not — and a click that never travelled is
// still a click.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { captureFiledFrom } from '../filedFromContext';
import { clearAim } from '../filerHover';
import { PLUS_DRAG_PX, beginPlusDrag, dropRectAt } from '../plusDrag';

const rects = new Map();
const place = (el, x, y, w, h) => {
    rects.set(el, { x, y, w, h });
    el.getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
    return el;
};
const $ = (sel) => document.querySelector(sel);
const fire = (type, x, y, extra = {}) => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...extra });
    window.dispatchEvent(e);
    return e;
};
const down = (x, y) => ({ button: 0, clientX: x, clientY: y });

describe('the + dragged (req #4197)', () => {
    let calls;
    beforeEach(() => {
        rects.clear();
        clearAim();
        document.head.innerHTML = '';
        document.body.innerHTML = `
            <div data-testid="category-card-862"><div data-testid="requirement-3958">Plain row</div></div>
            <div data-testid="requirement-filer"><button data-testid="requirement-filer-add">+</button></div>`;
        place($('[data-testid="category-card-862"]'), 200, 100, 600, 400);
        place($('[data-testid="requirement-3958"]'), 210, 150, 580, 40);
        place($('[data-testid="requirement-filer"]'), 20, 20, 170, 34);
        place($('[data-testid="requirement-filer-add"]'), 150, 22, 30, 30);
        document.elementsFromPoint = (px, py) => [...rects.entries()]
            .filter(([, r]) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)
            .map(([el]) => el).reverse();
        window.requestAnimationFrame = (fn) => { fn(); return 1; };
        window.cancelAnimationFrame = () => {};
        calls = { drop: [], start: 0, end: 0, move: [] };
    });
    const live = [];
    afterEach(() => { live.splice(0).forEach(stop => stop()); });
    const begin = (x = 160, y = 30) => live.push(beginPlusDrag(down(x, y), {
        onDrop: (d) => calls.drop.push(d), onStart: () => { calls.start += 1; },
        onEnd: () => { calls.end += 1; }, onMove: (m) => calls.move.push(m),
    }));

    it('a press that does not travel is no drag: nothing drawn, nothing dropped', () => {
        begin();
        fire('pointermove', 160 + PLUS_DRAG_PX - 2, 30);
        expect($('[data-testid="requirement-plus-drag"]')).toBeNull();
        fire('pointerup', 160, 30);
        expect(calls.start).toBe(0);
        expect(calls.drop).toEqual([]);
        expect(calls.end).toBe(1);
    });

    it('past the threshold the + is the pointer: a ghost, no native cursor, and the element under it outlined', () => {
        begin();
        fire('pointermove', 400, 170);
        expect(calls.start).toBe(1);
        const ghost = $('[data-testid="requirement-plus-drag"]');
        expect(ghost).not.toBeNull();
        expect(ghost.style.transform).toBe('translate(400px, 170px)');
        expect(ghost.style.pointerEvents).toBe('none');
        expect(document.getElementById('darwin-requirement-plus-drag-style').textContent).toContain('cursor: none');
        expect($('[data-testid="requirement-aim"]').getAttribute('data-aim')).toContain('requirement-3958');
        // Over the filer itself nothing is outlined.
        fire('pointermove', 160, 30);
        expect($('[data-testid="requirement-aim"]')).toBeNull();
    });

    it('a drop files at the drop point, whatever the pin, and tidies everything up', () => {
        begin();
        fire('pointermove', 400, 170);
        fire('pointerup', 400, 170);
        expect(calls.drop).toEqual([{ x: 400, y: 170, rect: dropRectAt(400, 170) }]);
        expect($('[data-testid="requirement-plus-drag"]')).toBeNull();
        expect($('[data-testid="requirement-aim"]')).toBeNull();
        expect(document.getElementById('darwin-requirement-plus-drag-style')).toBeNull();
        expect(calls.end).toBe(1);
    });

    it('swallows the click that follows a drag, once', async () => {
        begin();
        fire('pointermove', 400, 170);
        fire('pointerup', 400, 170);
        const onClick = vi.fn();
        document.body.addEventListener('click', onClick);
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(onClick).not.toHaveBeenCalled();
        await new Promise((r) => setTimeout(r, 5));
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('Escape cancels, and a drop back on the filer files nothing', () => {
        begin();
        fire('pointermove', 400, 170);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        fire('pointerup', 400, 170);
        expect(calls.drop).toEqual([]);
        expect($('[data-testid="requirement-plus-drag"]')).toBeNull();
        begin();
        fire('pointermove', 400, 170);
        fire('pointerup', 160, 30);
        expect(calls.drop).toEqual([]);
        expect(calls.end).toBe(2);
    });

    it('after Escape the release that ends the press clicks nothing either', async () => {
        begin();
        fire('pointermove', 400, 170);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 5)); // longer than a 0 ms swallow would live
        const onClick = vi.fn();
        document.body.addEventListener('click', onClick);
        fire('pointerup', 160, 30);
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(onClick).not.toHaveBeenCalled();
        expect(calls.drop).toEqual([]);
        await new Promise((r) => setTimeout(r, 5));
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('a release that never arrived abandons the drag: the next move with the button up, or a blur', () => {
        begin();
        fire('pointermove', 400, 170, { pointerType: 'mouse', buttons: 1 });
        expect($('[data-testid="requirement-plus-drag"]')).not.toBeNull();
        const up = new MouseEvent('pointermove', { clientX: 410, clientY: 175, bubbles: true, buttons: 0 });
        Object.defineProperty(up, 'pointerType', { value: 'mouse' });
        window.dispatchEvent(up);
        expect($('[data-testid="requirement-plus-drag"]')).toBeNull();
        expect($('[data-testid="requirement-aim"]')).toBeNull();
        expect(calls.end).toBe(1);
        begin();
        fire('pointermove', 400, 170);
        window.dispatchEvent(new Event('blur'));
        expect($('[data-testid="requirement-plus-drag"]')).toBeNull();
        fire('pointerup', 400, 170);
        expect(calls.drop).toEqual([]);
    });

    it('a secondary button never starts one', () => {
        const stop = beginPlusDrag({ button: 2, clientX: 1, clientY: 1 }, { onStart: () => { calls.start += 1; } });
        fire('pointermove', 400, 170);
        expect(calls.start).toBe(0);
        stop();
    });
});

describe('the dropped + records its place (req #4197)', () => {
    beforeEach(() => {
        rects.clear();
        document.body.innerHTML = '<div data-testid="category-card-862"><div data-testid="requirement-3958">Plain row</div></div>';
        place($('[data-testid="category-card-862"]'), 200, 100, 600, 400);
        place($('[data-testid="requirement-3958"]'), 210, 150, 580, 40);
        document.elementsFromPoint = (px, py) => [...rects.entries()]
            .filter(([, r]) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)
            .map(([el]) => el).reverse();
    });
    const args = { location: { pathname: '/swarm/pipelines', search: '', hash: '' }, profile: null,
        database: 'darwin_dev', theme: null, popupId: 'requirement-filer', popupStore: { open: true, dock: null } };

    it('points at the element under the drop with the pushpin NOT pressed', () => {
        const ctx = captureFiledFrom({ ...args, pinned: false, dropRect: dropRectAt(400, 170) });
        expect(ctx.pointedAtFrom).toBe('dropped');
        expect(ctx.pointedAt).toHaveLength(1);
        expect(ctx.pointedAt[0].testidPath).toContain('requirement-3958');
        expect(ctx.pointedAtReason).toBeUndefined();
    });

    it('is the same with the pushpin pressed; without a drop the unpinned filer still records nothing', () => {
        const pinned = captureFiledFrom({ ...args, pinned: true, dropRect: dropRectAt(400, 170) });
        expect(pinned.pointedAt[0].testidPath).toContain('requirement-3958');
        expect(pinned.popup.pinned).toBe(true);
        const plain = captureFiledFrom({ ...args, pinned: false });
        expect(plain.pointedAt).toBeNull();
        expect(plain.pointedAtFrom).toBeUndefined();
    });

    it('a drop on bare page says there was nothing there', () => {
        const ctx = captureFiledFrom({ ...args, dropRect: dropRectAt(1500, 800) });
        expect(ctx.pointedAt).toEqual([]);
        expect(ctx.pointedAtFrom).toBe('dropped');
    });
});
