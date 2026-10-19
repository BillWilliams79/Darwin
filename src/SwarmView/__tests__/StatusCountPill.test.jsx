// @vitest-environment jsdom
//
// Req #3644 — the Swarm-Start card's status selector is ONE pill per status:
// the count first, in a circle, then the name, with a transparent ring cut
// between circle and pill.

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import StatusCountPill, { formatPillCount } from '../StatusCountPill';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let roots = [];
function mount(props) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
        root.render(<StatusCountPill label="Approved" count={7} color="#c4b5fd"
                                     selected={false} onClick={vi.fn()}
                                     testId="pill" countTestId="pill-count" {...props} />);
    });
    return container;
}

afterEach(() => {
    act(() => { roots.forEach((r) => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
});

describe('StatusCountPill (req #3644)', () => {
    it('is one control: the count circle first, then the name', () => {
        const c = mount();
        const pill = c.querySelector('[data-testid="pill"]');
        expect(pill.tagName).toBe('BUTTON');
        expect(pill.firstElementChild.dataset.testid).toBe('pill-count');
        expect(pill.firstElementChild.textContent).toBe('7');
        expect(pill.lastElementChild.textContent).toBe('Approved');
    });

    it('shows zero as a datum and clamps at 99+', () => {
        expect(formatPillCount(0)).toBe('0');
        expect(formatPillCount(99)).toBe('99');
        expect(formatPillCount(1041)).toBe('99+');
        expect(formatPillCount(undefined)).toBe('0');
    });

    it('reports its pressed state and clicks through', () => {
        const onClick = vi.fn();
        const c = mount({ selected: true, onClick });
        const pill = c.querySelector('[data-testid="pill"]');
        expect(pill.getAttribute('aria-pressed')).toBe('true');
        act(() => { pill.click(); });
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('cuts the ring with a mask, so the gap is transparent rather than painted', () => {
        const c = mount();
        const pill = c.querySelector('[data-testid="pill"]');
        const classes = [...pill.classList].filter((cl) => cl.startsWith('css-'));
        const rule = [...document.querySelectorAll('style')]
            .flatMap((st) => [...st.sheet.cssRules])
            .find((r) => classes.some((cl) => r.selectorText === `.${cl}`));
        const mask = rule.style.getPropertyValue('mask-image')
            || rule.style.getPropertyValue('-webkit-mask-image');
        expect(mask).toMatch(/radial-gradient/);
        expect(mask).toMatch(/transparent/);
    });
});
