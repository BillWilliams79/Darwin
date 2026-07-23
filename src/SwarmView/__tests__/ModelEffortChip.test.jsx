// @vitest-environment jsdom
//
// Req #3029 — the Model/Effort cell renders one value in one of two modes. The
// rules that matter for correctness: the right label (with the documented
// null/unknown fallbacks — Opus for model, High for effort), and the right DOM
// shape per mode (pill = full label in a Chip, compact = the single leading
// letter in a Chip).

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

describe('ModelEffortChip (req #3029)', () => {
    it('pill mode renders the full model label inside a chip', () => {
        render(<ModelEffortChip kind="model" value="opus" mode="pill" />);
        expect(container.textContent).toContain('Opus');
        expect(hasChip()).toBe(true);
    });

    it('compact mode renders only the leading letter, inside a chip', () => {
        render(<ModelEffortChip kind="model" value="fable" mode="compact" />);
        expect(container.textContent.trim()).toBe('F');
        expect(hasChip()).toBe(true);
    });

    it('effort pill uses the effort label (XHigh)', () => {
        render(<ModelEffortChip kind="effort" value="xhigh" mode="pill" />);
        expect(container.textContent).toContain('XHigh');
    });

    it('effort compact uses the leading letter of the effort label', () => {
        render(<ModelEffortChip kind="effort" value="ultracode" mode="compact" />);
        expect(container.textContent.trim()).toBe('U');
    });

    it('falls back to Opus for a null model value', () => {
        render(<ModelEffortChip kind="model" value={null} mode="pill" />);
        expect(container.textContent).toContain('Opus');
    });

    it('falls back to High for a null effort value', () => {
        render(<ModelEffortChip kind="effort" value={null} mode="pill" />);
        expect(container.textContent).toContain('High');
    });

    it('forwards data-testid to the rendered node', () => {
        render(<ModelEffortChip kind="model" value="opus" mode="pill" data-testid="model-cell-42" />);
        expect(container.querySelector('[data-testid="model-cell-42"]')).toBeTruthy();
    });
});
