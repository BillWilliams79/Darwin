// @vitest-environment jsdom
//
// Req #3029 — the Model/Effort cell renders one value. req #3043 removed the
// compact/text modes, so pill (full label in a Chip) is the only rendering.
// The rules that matter for correctness: the right label (with the documented
// null/unknown fallbacks — Opus for model, High for effort), and the DOM shape.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ModelEffortChip from '../ModelEffortChip';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const render = (el) => {
    act(() => {
        root.render(el);
    });
};

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const hasChip = () => Boolean(container.querySelector('.MuiChip-root'));

describe('ModelEffortChip (req #3029 / #3043)', () => {
    it('renders the full model label inside a chip', () => {
        render(<ModelEffortChip kind="model" value="opus" />);
        expect(container.textContent).toContain('Opus');
        expect(hasChip()).toBe(true);
    });

    it('renders the full effort label inside a chip', () => {
        render(<ModelEffortChip kind="effort" value="xhigh" />);
        expect(container.textContent).toContain('XHigh');
        expect(hasChip()).toBe(true);
    });

    it('falls back to Opus for a null model value', () => {
        render(<ModelEffortChip kind="model" value={null} />);
        expect(container.textContent).toContain('Opus');
    });

    it('falls back to High for a null effort value', () => {
        render(<ModelEffortChip kind="effort" value={null} />);
        expect(container.textContent).toContain('High');
    });

    it('forwards data-testid to the rendered node', () => {
        render(<ModelEffortChip kind="model" value="opus" data-testid="model-cell-42" />);
        expect(container.querySelector('[data-testid="model-cell-42"]')).toBeTruthy();
    });
});
