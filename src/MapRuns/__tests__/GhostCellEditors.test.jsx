// @vitest-environment jsdom
//
// Req #3073 — the Maps cell editors after the migration onto GhostTextField.
//
// GhostTextField.test.jsx pins the commit contract in isolation. This file pins that
// the Maps editors are actually WIRED to it: that the rules from ghostFieldParsers
// reach the right props, that `onSave` is returned rather than dropped (an adapter
// that forgets to return resolves instantly and disables the rollback with no visible
// symptom), and that the Select/Autocomplete cells — which are NOT GhostTextFields —
// roll their own optimistic state back.
//
// Every test below is one of the four defects named in the requirement.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import {
    GhostInputCell,
    GhostNotesCell,
    GhostSelectCell,
    GhostDateTimeCell,
} from '../GhostCellEditors';
import { mapRunFields } from '../../utils/ghostFieldParsers';

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

const render = (el) => act(() => root.render(el));
const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);

// A controlled React input ignores a plain `el.value = x`; the value has to go
// through the native setter so React's own change tracking sees it.
const typeInto = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

const focus = (el) => act(() => el.focus());

// ASYNC act: blur starts the commit, and the commit's own follow-up state changes
// (the revert on a rejected write) land in a later microtask.
const blur = (el) => act(async () => { el.blur(); });

const pressKey = (el, key) => act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

const run = (over = {}) => ({
    id: 7,
    distance_mi: 12.5,
    avg_speed_mph: 15.28,
    run_time_sec: 3661,
    notes: 'a note',
    start_time: '2026-03-15 18:30:00',
    map_route_fk: 3,
    ...over,
});

const inputCell = (props) => (
    <GhostInputCell
        row={run()}
        field="distance_mi"
        rule={mapRunFields.distance_mi}
        {...props}
    />
);

describe('GhostInputCell — an invalid value is blocked, not silently dropped', () => {
    it('issues no write, keeps the bad text on screen, and says why', () => {
        // The original skipped the save whenever `parse` returned null and left no
        // trace at all, so the bad value sat in the grid looking saved until the next
        // refetch quietly reverted it.
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, '12abc');

        expect(onSave).not.toHaveBeenCalled();
        expect(el.value).toBe('12abc');
        expect(byTestId('map-run-distance_mi-message').textContent).toBe('Enter a number');
    });

    it('clears the verdict as the value becomes valid again', () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, 'nope');
        expect(byTestId('map-run-distance_mi-message')).not.toBeNull();

        typeInto(el, '14');
        expect(byTestId('map-run-distance_mi-message')).toBeNull();
    });
});

describe('GhostInputCell — a rejected write never stays on screen', () => {
    it('reverts the cell when onSave rejects', async () => {
        // Only reachable because MapRunsView's saveRunFields rethrows. If the adapter
        // in GhostCellEditors forgot to RETURN the promise this would silently pass
        // the write and fail here.
        const onSave = vi.fn().mockRejectedValue(new Error('500'));
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, '20');
        await blur(el);

        expect(onSave).toHaveBeenCalledExactlyOnceWith(7, { distance_mi: 20 });
        expect(el.value).toBe('12.5');
    });
});

describe('GhostInputCell — what it writes', () => {
    it('normalizes before it writes, so the stored value is the displayed one', async () => {
        // Without this the write stores 20.34, the refetch returns '20.3', and the
        // cell repaints after every commit.
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, '  20.34  ');
        await blur(el);

        expect(onSave).toHaveBeenCalledExactlyOnceWith(7, { distance_mi: 20.3 });
    });

    it('KEEPS the committed value while the refetch is still in flight', async () => {
        // The row prop is still the pre-write value here — that is the real state of
        // the app between a successful PUT and the invalidation round-tripping. The
        // cell must not repaint 12.5 over the edit it just made: that lasts a whole
        // network round trip, reads as "the save failed", and the retry it invites
        // writes the same value a second time.
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, '20');
        await blur(el);

        expect(byTestId('map-run-distance_mi').value).toBe('20.0');
    });

    it('adopts the server value once the refetch lands', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, '20');
        await blur(el);

        // The write went through and the query came back — including the case where
        // the server stored something other than what was sent.
        render(inputCell({ onSave, row: run({ distance_mi: 20 }) }));
        expect(byTestId('map-run-distance_mi').value).toBe('20.0');

        render(inputCell({ onSave, row: run({ distance_mi: 19.9 }) }));
        expect(byTestId('map-run-distance_mi').value).toBe('19.9');
    });

    it('does NOT write when the user only tabbed through', async () => {
        // The real bug this kills: every blur used to PUT unconditionally, so tabbing
        // across a row rewrote avg_speed_mph — DECIMAL(5,2) in the schema — with its
        // own one-decimal DISPLAY value. 15.28 became 15.3 in the database with no
        // edit at all.
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({
            onSave, field: 'avg_speed_mph', rule: mapRunFields.avg_speed_mph,
        }));

        const el = byTestId('map-run-avg_speed_mph');
        // Shown at the column's own DECIMAL(5,2) scale. Displaying it to one decimal
        // is what made the round-trip lossy in the first place.
        expect(el.value).toBe('15.28');
        focus(el);
        await blur(el);

        expect(onSave).not.toHaveBeenCalled();
    });

    it('sends the SQL NULL sentinel when a nullable column is emptied', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({
            onSave, field: 'avg_speed_mph', rule: mapRunFields.avg_speed_mph,
        }));

        const el = byTestId('map-run-avg_speed_mph');
        focus(el);
        typeInto(el, '');
        await blur(el);

        expect(onSave).toHaveBeenCalledExactlyOnceWith(7, { avg_speed_mph: 'NULL' });
    });

    it('reverts rather than emptying a NOT NULL column', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, '');
        await blur(el);

        expect(onSave).not.toHaveBeenCalled();
        expect(el.value).toBe('12.5');
    });
});

describe('GhostInputCell — Escape abandons the edit', () => {
    it('restores the stored value and issues no write', async () => {
        // There was no way to abandon an edit before. Note the trap pinned in #3063:
        // Escape blurs, and that blur lands in commit() with the abandoned value
        // still in scope — a naive implementation COMMITS what Escape threw away.
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, '99');
        pressKey(el, 'Escape');
        await blur(el);

        expect(onSave).not.toHaveBeenCalled();
        expect(el.value).toBe('12.5');
    });
});

describe('GhostInputCell — an external refetch does not clobber work in progress', () => {
    it('re-seeds a clean cell', () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));
        expect(byTestId('map-run-distance_mi').value).toBe('12.5');

        render(inputCell({ onSave, row: run({ distance_mi: 30 }) }));
        expect(byTestId('map-run-distance_mi').value).toBe('30.0');
    });

    it('leaves a DIRTY cell alone', () => {
        // The original re-seeded on any value change, which is harmless for its own
        // round trip and destroys in-progress typing when a genuinely external change
        // lands — another session, or a sibling write invalidating the row query.
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(inputCell({ onSave }));

        const el = byTestId('map-run-distance_mi');
        focus(el);
        typeInto(el, '44');

        render(inputCell({ onSave, row: run({ distance_mi: 30 }) }));
        expect(byTestId('map-run-distance_mi').value).toBe('44');
    });
});

describe('GhostNotesCell', () => {
    it('stores NULL rather than an empty string when the note is cleared', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(<GhostNotesCell row={run()} onSave={onSave} />);

        const el = byTestId('map-run-notes');
        focus(el);
        typeInto(el, '   ');
        await blur(el);

        expect(onSave).toHaveBeenCalledExactlyOnceWith(7, { notes: 'NULL' });
    });

    it('is a textarea, and therefore carries no type attribute', () => {
        // `type` is invalid DOM on a <textarea>; GhostTextField suppresses it there.
        render(<GhostNotesCell row={run()} onSave={vi.fn()} />);
        const el = byTestId('map-run-notes');
        expect(el.tagName).toBe('TEXTAREA');
        expect(el.hasAttribute('type')).toBe(false);
    });
});

describe('GhostDateTimeCell', () => {
    it('renders a native datetime-local seeded from the row', () => {
        render(<GhostDateTimeCell row={run()} timezone="America/Los_Angeles" onSave={vi.fn()} />);
        const el = byTestId('map-run-start-time');
        expect(el.getAttribute('type')).toBe('datetime-local');
        expect(el.value).toBe('2026-03-15T11:30');
    });

    it('writes the value back as a UTC datetime', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(<GhostDateTimeCell row={run()} timezone="America/Los_Angeles" onSave={onSave} />);

        const el = byTestId('map-run-start-time');
        focus(el);
        typeInto(el, '2026-03-15T12:30');
        await blur(el);

        expect(onSave).toHaveBeenCalledExactlyOnceWith(7, { start_time: '2026-03-15 19:30:00' });
    });

    it('reverts rather than writing NULL when the picker reads back blank', async () => {
        // A datetime-local reports '' until every segment is filled, so a half-typed
        // date arrives at commit as an empty string over a NOT NULL column.
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(<GhostDateTimeCell row={run()} timezone="America/Los_Angeles" onSave={onSave} />);

        const el = byTestId('map-run-start-time');
        focus(el);
        typeInto(el, '');
        await blur(el);

        expect(onSave).not.toHaveBeenCalled();
        expect(el.value).toBe('2026-03-15T11:30');
    });
});

describe('GhostSelectCell — not a text field, but it still rolls back', () => {
    const options = [
        { value: 3, label: 'Old Route' },
        { value: 4, label: 'New Route' },
    ];

    const selected = () => container.querySelector('[role="combobox"]').textContent;

    // MUI's Select opens on mousedown, not click, and renders its listbox into a
    // portal outside `container`.
    const openAndPick = async (index) => {
        await act(async () => {
            container.querySelector('[role="combobox"]')
                .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        await act(async () => {
            document.querySelectorAll('[role="option"]')[index].click();
        });
    };

    it('keeps the new value when the write succeeds', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(<GhostSelectCell row={run()} value={3} options={options} onSave={onSave} />);
        expect(selected()).toBe('Old Route');

        await openAndPick(1);

        expect(onSave).toHaveBeenCalledExactlyOnceWith(7, 4);
        expect(selected()).toBe('New Route');
    });

    it('rolls the optimistic value back when the write is refused', async () => {
        // Without this the cell keeps showing a route the run was never assigned.
        // The catch is also what stops a rejecting onSave escaping this void handler
        // as an unhandled rejection.
        const onSave = vi.fn().mockRejectedValue(new Error('500'));
        render(<GhostSelectCell row={run()} value={3} options={options} onSave={onSave} />);

        await openAndPick(1);

        expect(onSave).toHaveBeenCalledExactlyOnceWith(7, 4);
        expect(selected()).toBe('Old Route');
    });
});
