// @vitest-environment jsdom
//
// req #3652 — the snackbar carries an optional action button (the focus-loss
// alert's "Copy for Claude"), and an error message never inherits one.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SnackBar } from '../SnackBar';
import { useSnackBarStore } from '../../../stores/useSnackBarStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
});

function render(props) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<SnackBar snackBarOpen setSnackBarOpen={() => {}} snackBarMessage="msg" {...props} />);
    });
}

describe('SnackBar action (req #3652)', () => {
    it('renders the action button and calls it on click', () => {
        const onClick = vi.fn();
        render({ snackBarAction: { label: 'Copy for Claude', onClick } });
        const button = document.querySelector('[data-testid="snackbar-action"]');
        expect(button.textContent).toBe('Copy for Claude');
        act(() => button.click());
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[aria-label="Close notification"]')).not.toBeNull();
    });

    it('renders no action button without one', () => {
        render({});
        expect(document.querySelector('[data-testid="snackbar-action"]')).toBeNull();
    });

    it('showError clears an action left by showMessage', () => {
        const { showMessage, showError } = useSnackBarStore.getState();
        showMessage('alert', { duration: 30000, action: { label: 'Copy for Claude', onClick: () => {} } });
        expect(useSnackBarStore.getState().action.label).toBe('Copy for Claude');
        showError('plain error');
        expect(useSnackBarStore.getState()).toMatchObject({ message: 'plain error', action: null, duration: null });
        showMessage('alert', { action: { label: 'x', onClick: () => {} } });
        showError({ httpStatus: { httpStatus: 500 } }, 'Save failed');
        expect(useSnackBarStore.getState()).toMatchObject({ message: 'Save failed 500', action: null });
    });
});
