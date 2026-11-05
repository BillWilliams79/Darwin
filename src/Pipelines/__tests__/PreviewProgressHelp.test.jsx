// @vitest-environment jsdom
// req #4196 — the Progress on/off button is gone; what stays is the colour help:
// a hover popup (the plan visualizer's own component), no toggle.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import PreviewProgressHelp from '../PreviewProgressHelp';

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

const trigger = () => container.querySelector('[data-testid="pipelines-preview-progress-help-button"]');
const help = () => document.querySelector('[data-testid="pipelines-preview-progress-help"]');
const hover = (el) => act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
const unhover = (el) => act(() => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });

describe('PreviewProgressHelp (req #4196)', () => {
    it('renders only the help icon: no Progress toggle chip', () => {
        act(() => root.render(<PreviewProgressHelp />));
        expect(trigger()).not.toBeNull();
        expect(container.querySelector('[data-testid="pipelines-preview-color-percent"]')).toBeNull();
        expect(container.querySelector('.MuiChip-root')).toBeNull();
    });

    it('shows no standing key; hovering the icon pops the progress definitions, leaving closes it', () => {
        act(() => root.render(<PreviewProgressHelp />));
        expect(help()).toBeNull();
        hover(trigger());
        expect(help()).not.toBeNull();
        expect(help().getAttribute('data-pinned')).toBe('false');
        const words = [...help().querySelectorAll('[data-testid="pipeline-viz-legend-word"]')]
            .map((n) => n.textContent);
        expect(words).toEqual(['0%', '1–25%', '26–50%', '51–75%', '76–99%', '100%', 'no work']);
        unhover(trigger());
        expect(help()).toBeNull();
    });
});
