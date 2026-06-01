import { describe, it, expect, vi } from 'vitest';
import { useCrudCallbacks } from '../useCrudCallbacks';

// useCrudCallbacks holds no internal React state (no useState/useEffect/useRef),
// so it can be invoked as a plain factory and its returned closures exercised
// directly — no renderer required.

describe('useCrudCallbacks.fieldChange — immutability (req #2747)', () => {
    it('does not mutate the original item object in place', () => {
        // Simulate the real-world hazard: the items array is seeded from TanStack
        // query data via a shallow copy, so each row object is shared by reference
        // with the cache. Capture the original reference to prove it is untouched.
        const original = { id: 7, title: 'before' };
        const items = [original];
        const setItems = vi.fn();

        const { fieldChange } = useCrudCallbacks({
            items, setItems, fieldName: 'title', saveFn: () => {},
        });

        fieldChange({ target: { value: 'after' } }, 0);

        // Original object (the cache-shared reference) must be unchanged.
        expect(original.title).toBe('before');

        // setItems received a brand-new array with a brand-new object at the index.
        expect(setItems).toHaveBeenCalledTimes(1);
        const next = setItems.mock.calls[0][0];
        expect(next).not.toBe(items);
        expect(next[0]).not.toBe(original);
        expect(next[0]).toEqual({ id: 7, title: 'after' });
    });

    it('leaves sibling rows referentially identical (only the edited index changes)', () => {
        const a = { id: 1, title: 'a' };
        const b = { id: 2, title: 'b' };
        const setItems = vi.fn();

        const { fieldChange } = useCrudCallbacks({
            items: [a, b], setItems, fieldName: 'title', saveFn: () => {},
        });

        fieldChange({ target: { value: 'edited' } }, 1);

        const next = setItems.mock.calls[0][0];
        expect(next[0]).toBe(a);          // untouched sibling keeps its reference
        expect(next[1]).not.toBe(b);      // edited row is a fresh object
        expect(next[1].title).toBe('edited');
        expect(b.title).toBe('b');        // original sibling unmutated
    });
});
