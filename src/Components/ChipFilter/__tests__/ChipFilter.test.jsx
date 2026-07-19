// @vitest-environment jsdom
//
// Req #2992 — ChipFilter rendering and toggle behavior.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import ChipFilter from '../ChipFilter';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
    { value: 2, label: 'Mac Mini' },
    { value: 3, label: 'MCHP Windows' },
    { value: 'unassigned', label: 'Unassigned' },
];

let container;
let root;

const render = (ui) => {
    act(() => { root.render(ui); });
};

const chip = (value, prefix = 'filter-chip') =>
    container.querySelector(`[data-testid="${prefix}-${value}"]`);

// MUI renders variant="outlined" as a class on the chip root.
const isOutlined = (el) => el.className.includes('outlined');

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
});

describe('ChipFilter', () => {
    it('renders one chip per option with its label', () => {
        render(<ChipFilter options={OPTIONS} selected={null} onToggle={() => {}} testId="f" />);
        expect(container.querySelector('[data-testid="f"]')).toBeTruthy();
        OPTIONS.forEach(o => {
            expect(chip(o.value)).toBeTruthy();
            expect(chip(o.value).textContent).toContain(o.label);
        });
    });

    it('treats null selection as everything selected', () => {
        render(<ChipFilter options={OPTIONS} selected={null} onToggle={() => {}} testId="f" />);
        OPTIONS.forEach(o => expect(isOutlined(chip(o.value))).toBe(false));
    });

    it('treats undefined selection as everything selected', () => {
        render(<ChipFilter options={OPTIONS} onToggle={() => {}} testId="f" />);
        OPTIONS.forEach(o => expect(isOutlined(chip(o.value))).toBe(false));
    });

    it('renders unselected options outlined', () => {
        render(<ChipFilter options={OPTIONS} selected={[2]} onToggle={() => {}} testId="f" />);
        expect(isOutlined(chip(2))).toBe(false);
        expect(isOutlined(chip(3))).toBe(true);
        expect(isOutlined(chip('unassigned'))).toBe(true);
    });

    it('renders every chip outlined for an empty selection', () => {
        render(<ChipFilter options={OPTIONS} selected={[]} onToggle={() => {}} testId="f" />);
        OPTIONS.forEach(o => expect(isOutlined(chip(o.value))).toBe(true));
    });

    it('calls onToggle with the option value on click', () => {
        const onToggle = vi.fn();
        render(<ChipFilter options={OPTIONS} selected={null} onToggle={onToggle} testId="f" />);
        act(() => { chip(3).click(); });
        expect(onToggle).toHaveBeenCalledWith(3);

        act(() => { chip('unassigned').click(); });
        expect(onToggle).toHaveBeenCalledWith('unassigned');
    });

    it('honors a custom chip test-id prefix', () => {
        render(
            <ChipFilter options={OPTIONS} selected={null} onToggle={() => {}}
                        testId="f" chipTestIdPrefix="machine-filter-chip" />
        );
        expect(chip(2, 'machine-filter-chip')).toBeTruthy();
        expect(chip(2)).toBeNull();
    });

    // MUI's `sx` compiles to an emotion class rather than an inline style, so
    // these assert via getComputedStyle (jsdom resolves emotion's injected
    // <style> tags) rather than element.style.
    const OPT_COLORED = [{
        value: 'active',
        label: 'Implementing',
        chipProps: { sx: { bgcolor: 'rgb(76, 175, 80)' } },
    }];

    it('applies caller-supplied chipProps colors to selected chips', () => {
        render(<ChipFilter options={OPT_COLORED} selected={['active']} onToggle={() => {}} testId="f" />);
        expect(getComputedStyle(chip('active')).backgroundColor).toBe('rgb(76, 175, 80)');
    });

    it('does not paint the option color onto an unselected chip', () => {
        render(<ChipFilter options={OPT_COLORED} selected={[]} onToggle={() => {}} testId="f" />);
        expect(getComputedStyle(chip('active')).backgroundColor).not.toBe('rgb(76, 175, 80)');
        expect(isOutlined(chip('active'))).toBe(true);
    });

    it('dims unselected chips and leaves selected chips at full opacity', () => {
        render(<ChipFilter options={OPT_COLORED} selected={[]} onToggle={() => {}} testId="f" />);
        expect(getComputedStyle(chip('active')).opacity).toBe('0.5');

        render(<ChipFilter options={OPT_COLORED} selected={['active']} onToggle={() => {}} testId="f" />);
        expect(getComputedStyle(chip('active')).opacity).not.toBe('0.5');
    });

    it('renders nothing but the container for an empty option list', () => {
        render(<ChipFilter options={[]} selected={null} onToggle={() => {}} testId="f" />);
        expect(container.querySelector('[data-testid="f"]').children).toHaveLength(0);
    });
});
