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

describe('PreviewColorChips — colour help like the visualizer (req #4063)', () => {
    it('shows no standing key; hovering a chip pops its help, leaving closes it', () => {
        act(() => root.render(<PreviewColorChips mode="percent" onChange={() => {}} />));
        expect(help()).toBeNull();
        expect(document.querySelector('[data-testid="pipelines-preview-color-key"]')).toBeNull();

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

    it('explains an inactive chip too, with that scale\'s own values', () => {
        act(() => root.render(<PreviewColorChips mode="percent" onChange={() => {}} />));
        hover(chip('autonomy'));
        const words = [...help().querySelectorAll('[data-testid="pipeline-viz-legend-word"]')]
            .map((n) => n.textContent);
        expect(words).toEqual(['discuss', 'planned', 'implemented', 'deployed', 'no work']);
    });

    it('a click still selects, and the lit chip returns to Progress', () => {
        const onChange = vi.fn();
        act(() => root.render(<PreviewColorChips mode="model" onChange={onChange} />));
        act(() => chip('state').click());
        expect(onChange).toHaveBeenLastCalledWith('state');
        act(() => chip('model').click());
        expect(onChange).toHaveBeenLastCalledWith('percent');
    });
});
