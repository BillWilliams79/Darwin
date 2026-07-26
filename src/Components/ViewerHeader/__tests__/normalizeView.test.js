// Req #3067 — the generic form of the `activeView` line.
//
// Pure function, so no harness. The rules it encodes are small and each one
// corresponds to a real failure that shipped or nearly shipped:
//
//   * An unmatched ToggleButtonGroup value selects NOTHING. That is what makes a
//     stale stored view a visible bug rather than a harmless one, and it is why
//     this function exists at all.
//   * It must never write back. The test for that is in ViewerHeader's suite,
//     because "did not call a setter" is a statement about the component.

import { describe, it, expect } from 'vitest';

import { normalizeView } from '../normalizeView';

const CARDS = { value: 'cards', label: 'Cards view' };
const TABLE = { value: 'table', label: 'Table view' };

describe('normalizeView', () => {
    it('passes an enabled value straight through', () => {
        expect(normalizeView('table', [CARDS, TABLE])).toBe('table');
        expect(normalizeView('cards', [CARDS, TABLE])).toBe('cards');
    });

    it('falls back to the first entry when the value names no view at all', () => {
        // The req #3063 case: 'table' sitting in storage with no Table button.
        expect(normalizeView('table', [CARDS])).toBe('cards');
        // And a view that was deleted outright rather than merely disabled.
        expect(normalizeView('trends', [CARDS, TABLE])).toBe('cards');
    });

    it('falls back past a DISABLED entry rather than selecting it', () => {
        // V1's disabled-button form: the button is on screen holding the group's
        // width, but selecting it would render a view that does not exist.
        expect(normalizeView('table', [CARDS, { ...TABLE, disabled: true }])).toBe('cards');
    });

    it('picks the first ENABLED entry, not the first entry, when falling back', () => {
        // The ordering trap: a page whose first view is the disabled one would
        // otherwise normalize to something it cannot render.
        const views = [{ ...CARDS, disabled: true }, TABLE];
        expect(normalizeView('trends', views)).toBe('table');
    });

    it('still returns something when every entry is disabled', () => {
        // Degenerate, but the alternative is `undefined` reaching
        // ToggleButtonGroup — which is the no-selection state this function was
        // written to prevent.
        const views = [{ ...CARDS, disabled: true }, { ...TABLE, disabled: true }];
        expect(normalizeView('trends', views)).toBe('cards');
    });

    it('tolerates an empty or missing view list', () => {
        expect(normalizeView('cards', [])).toBeUndefined();
        expect(normalizeView('cards')).toBeUndefined();
    });
});
