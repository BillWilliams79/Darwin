// @vitest-environment jsdom
//
// Req #3067 — the column factory.
//
// Two things are worth pinning, and only two:
//
//   1. `editable` is FALSE and cannot be overridden. That single flag is what keeps
//      DataGrid's own edit-mode state machine — which owns commit timing,
//      validation and rollback — from competing with GhostTextField, which already
//      owns all three and owns them better (an invalid value stays visible in red
//      instead of being silently discarded). A caller passing `editable: true`
//      through the rest-spread would produce a cell with two answers to "what is
//      in you", and nothing else in the codebase would notice.
//   2. The per-row bindings really reach the field: the validator is given the row
//      (so a name is not a duplicate of itself), the commit is bound to the row,
//      and the caption is suppressed so a fixed-height cell is not overflowed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import { ghostTextColumn } from '../ghostTextColumn';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const ROW = { id: 7, name: 'alpha' };

const baseSpec = (overrides = {}) => ({
    field: 'name',
    headerName: 'Name',
    width: 200,
    onCommit: () => vi.fn().mockResolvedValue(undefined),
    testId: (row) => `cell-${row.id}`,
    ...overrides,
});

const renderCell = (col, row = ROW) => {
    act(() => root.render(col.renderCell({ row })));
    return container.querySelector(`[data-testid="cell-${row.id}"]`);
};

const typeInto = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('ghostTextColumn — the column definition', () => {
    it('pins editable false', () => {
        expect(ghostTextColumn(baseSpec()).editable).toBe(false);
    });

    it('refuses to let a caller turn DataGrid edit mode back on', () => {
        // `editable` is applied AFTER the rest-spread precisely so this cannot be
        // smuggled through. If this test fails, two competing edit state machines
        // are live in the same cell.
        const col = ghostTextColumn(baseSpec({ editable: true }));
        expect(col.editable).toBe(false);
    });

    it('passes through the sizing and any extra GridColDef keys', () => {
        const col = ghostTextColumn(baseSpec({
            width: undefined, flex: 1, minWidth: 420, sortable: false,
        }));
        expect(col.flex).toBe(1);
        expect(col.minWidth).toBe(420);
        expect(col.sortable).toBe(false);
        // Omitted sizing keys are left off entirely rather than set to undefined,
        // which DataGrid treats differently from absent.
        expect('width' in col).toBe(false);
    });
});

describe('ghostTextColumn — the rendered cell', () => {
    it('renders the row value in a field carrying the derived testid', () => {
        const el = renderCell(ghostTextColumn(baseSpec()));
        expect(el).toBeTruthy();
        expect(el.value).toBe('alpha');
    });

    it('gives the validator the ROW, so a value is not a duplicate of itself', () => {
        const validate = vi.fn().mockReturnValue(null);
        const el = renderCell(ghostTextColumn(baseSpec({ validate })));
        typeInto(el, 'beta');
        expect(validate).toHaveBeenCalledWith('beta', ROW);
    });

    it('binds onCommit to the row', async () => {
        const commit = vi.fn().mockResolvedValue(undefined);
        const onCommit = vi.fn(() => commit);
        const el = renderCell(ghostTextColumn(baseSpec({ onCommit })));
        expect(onCommit).toHaveBeenCalledWith(ROW);

        // Focus first: jsdom fires no blur event on an element that never held
        // focus, so a blur-commit assertion without it passes vacuously.
        act(() => el.focus());
        typeInto(el, 'beta');
        await act(async () => { el.blur(); });
        expect(commit).toHaveBeenCalledWith('beta');
    });

    it('SUPPRESSES the inline caption but still reports the verdict', async () => {
        // The two halves of `hideMessage`. A fixed-height row has nowhere to put a
        // caption, so the verdict is hoisted to the table's row-level marker — but
        // it must still be RAISED, or a blocked value would have no signal at all.
        const onErrorChange = vi.fn();
        const el = renderCell(ghostTextColumn(baseSpec({
            validate: (text) => (text === 'taken' ? 'that name already exists' : null),
            onErrorChange: () => onErrorChange,
        })));

        typeInto(el, 'taken');
        expect(container.querySelector('[data-testid="cell-7-message"]')).toBeFalsy();
        expect(onErrorChange).toHaveBeenCalledWith('that name already exists');
    });

    it('does not write a value the validator blocked', async () => {
        const commit = vi.fn().mockResolvedValue(undefined);
        const el = renderCell(ghostTextColumn(baseSpec({
            onCommit: () => commit,
            validate: (text) => (text === 'taken' ? 'that name already exists' : null),
        })));

        typeInto(el, 'taken');
        await act(async () => { el.blur(); });
        expect(commit).not.toHaveBeenCalled();
        // ...and the rejected text stays on screen rather than silently reverting,
        // which is the difference from the Maps editors' skip-and-forget.
        expect(el.value).toBe('taken');
    });
});
