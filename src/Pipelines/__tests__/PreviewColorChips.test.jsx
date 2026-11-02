// @vitest-environment jsdom
// req #4063 — the preview-colour chips carry the plan visualizer's colour help:
// a hover popup per chip (not a standing key), the same popup component.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import PreviewColorChips from '../PreviewColorChips';

let container;
let root;
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const chip = (k) => container.querySelector(`[data-testid="pipelines-preview-color-${k}"]`);
const help = () => document.querySelector('[data-testid="pipelines-preview-color-help"]');
const hover = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
});
const unhover = (el) => act(() => {
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
});

describe('PreviewColorChips — the one Progress button (req #4063, #4184)', () => {
    it('renders only the Progress button; no other colour chips', () => {
        act(() => root.render(<PreviewColorChips mode="percent" onChange={() => {}} />));
        expect(chip('percent')).not.toBeNull();
        for (const k of ['state', 'session', 'autonomy', 'model', 'machine', 'flags']) {
            expect(chip(k)).toBeNull();
        }
    });

    it('shows no standing key; hovering the button pops its help, leaving closes it', () => {
        act(() => root.render(<PreviewColorChips mode="percent" onChange={() => {}} />));
        expect(help()).toBeNull();
        hover(chip('percent'));
        expect(help()).not.toBeNull();
        expect(help().getAttribute('data-key')).toBe('percent');
        expect(help().getAttribute('data-pinned')).toBe('false');
        const words = [...help().querySelectorAll('[data-testid="pipeline-viz-legend-word"]')]
            .map((n) => n.textContent);
        expect(words).toEqual(['0%', '1–25%', '26–50%', '51–75%', '76–99%', '100%', 'no work']);
        unhover(chip('percent'));
        expect(help()).toBeNull();
    });

    it('still explains itself while switched off', () => {
        act(() => root.render(<PreviewColorChips mode="clean" onChange={() => {}} />));
        hover(chip('percent'));
        expect(help()).not.toBeNull();
    });

    it('a click toggles Progress off to the clean look and back on', () => {
        const onChange = vi.fn();
        act(() => root.render(<PreviewColorChips mode="percent" onChange={onChange} />));
        act(() => chip('percent').click());
        expect(onChange).toHaveBeenLastCalledWith('clean');
        act(() => root.render(<PreviewColorChips mode="clean" onChange={onChange} />));
        act(() => chip('percent').click());
        expect(onChange).toHaveBeenLastCalledWith('percent');
    });
});
