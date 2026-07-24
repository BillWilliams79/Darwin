// @vitest-environment jsdom
//
// req #3046 — the Model/Effort cell renders a small COLORED GLYPH ICON (not a
// pill chip): a robot glyph for Model, a bolt glyph for Effort, each filled with
// the value's red→green ramp color (req #3044). The color mapping itself is unit
// tested in modelChipStyles/effortChipStyles.test.js (aiModelIconColor /
// effortIconColor). Here we assert the rendered DOM shape: it's an SVG icon, NOT
// a Chip, and the tooltip label — surfaced as the icon's aria-label — names the
// axis + value (with the documented null/unknown fallbacks).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ModelEffortIcon from '../ModelEffortIcon';

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
const svg = () => container.querySelector('svg');
// MUI Tooltip applies its title to the child as aria-label — a stable signal of
// the axis + value shown, independent of the exact glyph component chosen.
const ariaLabel = () => svg()?.getAttribute('aria-label');

describe('ModelEffortIcon (req #3046)', () => {
    it('renders an icon (not a chip) for a model value', () => {
        render(<ModelEffortIcon kind="model" value="opus" />);
        expect(svg()).toBeTruthy();
        expect(hasChip()).toBe(false);
        expect(ariaLabel()).toBe('Model: Opus');
    });

    it('renders an icon (not a chip) for an effort value', () => {
        render(<ModelEffortIcon kind="effort" value="xhigh" />);
        expect(svg()).toBeTruthy();
        expect(hasChip()).toBe(false);
        expect(ariaLabel()).toBe('Effort: XHigh');
    });

    it('falls back to Opus label for a null model value', () => {
        render(<ModelEffortIcon kind="model" value={null} />);
        expect(ariaLabel()).toBe('Model: Opus');
    });

    it('falls back to High label for a null effort value', () => {
        render(<ModelEffortIcon kind="effort" value={null} />);
        expect(ariaLabel()).toBe('Effort: High');
    });

    it('forwards data-testid to the rendered glyph', () => {
        render(<ModelEffortIcon kind="model" value="opus" data-testid="model-cell-42" />);
        expect(container.querySelector('svg[data-testid="model-cell-42"]')).toBeTruthy();
    });
});
