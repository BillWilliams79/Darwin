// @vitest-environment jsdom
//
// req #3506 — the "Closed" title option, driven THROUGH THE CONTROL.
//
// `closedTasks.test.js` pins the window arithmetic. That is not enough on its
// own: what the requester will see is a captioned group of three buttons whose
// selected one can be clicked off again, and the off state is MUI handing the
// change handler a `null` the store has to accept. A pure-helper suite stays
// green through a control that renders the buttons and drops the click.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import ClosedTasksControl from '../ClosedTasksControl';
import { useClosedTasksStore } from '../../stores/useClosedTasksStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<ClosedTasksControl />); });
};

const click = async (testId) => {
    const el = container.querySelector(`[data-testid="${testId}"]`);
    expect(el, `missing ${testId}`).toBeTruthy();
    await act(async () => { el.click(); });
};

const windowValue = () => useClosedTasksStore.getState().closedWindow;

beforeEach(() => {
    useClosedTasksStore.setState({ closedWindow: null });
});

afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    container?.remove();
    root = null;
    container = null;
});

describe('ClosedTasksControl', () => {
    it('renders the "Closed" caption and the three buttons', async () => {
        await mount();
        expect(container.textContent).toContain('Closed');
        expect(container.querySelector('[data-testid="closed-window-1h"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="closed-window-24h"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="closed-window-all"]')).toBeTruthy();
    });

    it('defaults to OFF — no window selected', async () => {
        await mount();
        expect(windowValue()).toBeNull();
        expect(container.querySelector('[data-testid="closed-window-1h"]').getAttribute('aria-pressed')).toBe('false');
    });

    it('selects each window when its button is clicked', async () => {
        await mount();

        await click('closed-window-1h');
        expect(windowValue()).toBe('1h');

        await click('closed-window-24h');
        expect(windowValue()).toBe('24h');

        await click('closed-window-all');
        expect(windowValue()).toBe('all');
    });

    it('marks the selected button pressed', async () => {
        await mount();
        await click('closed-window-24h');
        expect(container.querySelector('[data-testid="closed-window-24h"]').getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[data-testid="closed-window-1h"]').getAttribute('aria-pressed')).toBe('false');
    });

    it('turns the option back OFF when the selected button is clicked again', async () => {
        await mount();
        await click('closed-window-1h');
        expect(windowValue()).toBe('1h');

        await click('closed-window-1h');
        expect(windowValue()).toBeNull();
    });
});
