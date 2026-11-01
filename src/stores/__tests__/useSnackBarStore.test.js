// req #4159 — the snackbar keeps its last five messages for the Requirement
// Filer's debug capture: an error shown and hidden 2 s later is still there
// when the reader presses the filer.
import { describe, it, expect, beforeEach } from 'vitest';
import { SNACKBAR_HISTORY_MAX, SNACKBAR_HISTORY_TEXT_MAX, useSnackBarStore } from '../useSnackBarStore';

describe('useSnackBarStore history (req #4159)', () => {
    beforeEach(() => useSnackBarStore.setState({ open: false, message: '', history: [] }));

    it('records errors and messages, newest last, each with its time and kind', () => {
        const { showError, showMessage } = useSnackBarStore.getState();
        showError('Epic 388 cannot be deleted: its plan is locked. Unlock it first.');
        showError({ httpStatus: { httpStatus: 500 } }, 'Could not delete epic');
        showMessage('Focus lost to <button>');
        const h = useSnackBarStore.getState().history;
        expect(h.map(x => [x.kind, x.message])).toEqual([
            ['error', 'Epic 388 cannot be deleted: its plan is locked. Unlock it first.'],
            ['error', 'Could not delete epic 500'],
            ['message', 'Focus lost to <button>'],
        ]);
        expect(h.every(x => typeof x.t === 'number')).toBe(true);
    });

    it('keeps at most five, each at most 500 characters, and survives a close', () => {
        const { showError, close } = useSnackBarStore.getState();
        for (let i = 0; i < 8; i++) showError(`e${i} ${'x'.repeat(600)}`);
        close();
        const h = useSnackBarStore.getState().history;
        expect(h).toHaveLength(SNACKBAR_HISTORY_MAX);
        expect(h[0].message.startsWith('e3 ')).toBe(true);
        expect(h.every(x => x.message.length <= SNACKBAR_HISTORY_TEXT_MAX)).toBe(true);
    });

    it('a store reset without history does not break the next message', () => {
        useSnackBarStore.setState({ history: undefined });
        useSnackBarStore.getState().showError('after reset');
        expect(useSnackBarStore.getState().history).toHaveLength(1);
    });
});
