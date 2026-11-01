// @vitest-environment jsdom
//
// Req #4171 — Esc on the epic editor closes it at once when nothing was edited,
// and asks before discarding typed edits (Cancel never asks).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../../stores/useSnackBarStore', () => ({
    useSnackBarStore: (sel) => sel({ showError: vi.fn() }),
}));

import EpicEditDialog from '../EpicEditDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
afterEach(() => {
    if (root) act(() => { root.unmount(); });
    root = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

const EPIC = { id: 5, initiative_fk: 2, title: 'Drain', notes: 'n', run: 'auto', locked: false };

function render() {
    const onClose = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<EpicEditDialog open epic={EPIC} initiativeOptions={[{ id: 2, title: 'I' }]}
                                    onClose={onClose} onSaved={vi.fn()} />);
    });
    return onClose;
}
const esc = () => act(() => {
    document.querySelector('[data-testid="epic-edit-dialog"]')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});

describe('EpicEditDialog Esc (req #4171)', () => {
    it('closes at once when nothing was edited', () => {
        const confirm = vi.spyOn(window, 'confirm');
        const onClose = render();
        esc();
        expect(confirm).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('asks before discarding an edit', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const onClose = render();
        const input = document.querySelector('input[type="text"], input:not([type])');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        act(() => { setter.call(input, 'Renamed'); input.dispatchEvent(new Event('input', { bubbles: true })); });
        esc();
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });
});
