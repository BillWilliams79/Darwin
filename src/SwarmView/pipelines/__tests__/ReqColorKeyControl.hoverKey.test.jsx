// @vitest-environment jsdom
//
// Req #3644 — the Requirements page's colour key is a HOVER POP under the Color
// chip being hovered (user directive: it "is consuming a band of the screen
// vertically ... make it a hover pop ... esc and hover off dismiss"). The plan
// toolbar passes no `renderKey` and keeps its tooltips.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import ReqColorKeyControl from '../ReqColorKeyControl';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let roots = [];
function mount(props) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
        root.render(<ReqColorKeyControl colorKey="state" onChangeColorKey={vi.fn()}
                                        testIdPrefix="t" {...props} />);
    });
    return container;
}

afterEach(() => {
    act(() => { roots.forEach((r) => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
});

const keyFor = (k) => <div data-testid={`key-${k}`}>{k} key</div>;
const hover = (el, type) => act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
});
// React's onMouseEnter/Leave are driven by mouseover/mouseout.
const enter = (el) => hover(el, 'mouseover');
const leave = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
});

describe('ReqColorKeyControl hover key (req #3644)', () => {
    it('pops the HOVERED scale\'s key below its chip', () => {
        const c = mount({ renderKey: keyFor });
        expect(document.querySelector('[data-testid^="key-"]')).toBeNull();
        enter(c.querySelector('[data-testid="t-colorkey-autonomy"]'));
        expect(document.querySelector('[data-testid="key-autonomy"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="t-colorkey-pop"]')).not.toBeNull();
    });

    it('closes when the pointer leaves the chip', () => {
        const c = mount({ renderKey: keyFor });
        const chip = c.querySelector('[data-testid="t-colorkey-state"]');
        enter(chip);
        expect(document.querySelector('[data-testid="key-state"]')).not.toBeNull();
        leave(chip);
        expect(document.querySelector('[data-testid="key-state"]')).toBeNull();
    });

    it('closes on Esc', () => {
        const c = mount({ renderKey: keyFor });
        enter(c.querySelector('[data-testid="t-colorkey-session"]'));
        expect(document.querySelector('[data-testid="key-session"]')).not.toBeNull();
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.querySelector('[data-testid="key-session"]')).toBeNull();
    });

    it('the pop takes no pointer events, so it cannot flicker itself shut', () => {
        const c = mount({ renderKey: keyFor });
        enter(c.querySelector('[data-testid="t-colorkey-state"]'));
        const pop = document.querySelector('[data-testid="t-colorkey-pop"]');
        expect(getComputedStyle(pop).pointerEvents).toBe('none');
    });

    it('without renderKey (the plan toolbar) there is no pop', () => {
        const c = mount({});
        enter(c.querySelector('[data-testid="t-colorkey-state"]'));
        expect(document.querySelector('[data-testid="t-colorkey-pop"]')).toBeNull();
    });
});
