// @vitest-environment jsdom
//
// Req #3063 — the commit contract of the shared edit-in-place field.
//
// Worth a mounted harness rather than pure-function tests: every rule here is a
// rule about WHEN a write happens and what the field shows afterwards, and the
// subtle one (re-seeding from the server without clobbering work in progress) is
// the same class of defect as req #2884, which needed a harness like this to find.
//
// The specific regression these tests exist to prevent: measuring dirtiness
// against the incoming `value` prop instead of the value the field was last
// seeded with. That reads as equivalent and is not — the instant an external
// change arrives, text and value differ for that reason alone, the field calls
// itself dirty, and it never accepts a server update again.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import GhostTextField from '../GhostTextField';

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

const field = () => container.querySelector('[data-testid="f"]');
const message = () => container.querySelector('[data-testid="f-message"]');

const render = (props) => act(() => {
    root.render(<GhostTextField testId="f" {...props} />);
});

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
// (the revert on a rejected write) land in a later microtask. An async act flushes
// them inside the act scope instead of leaving React to warn about them.
const blur = (el) => act(async () => { el.blur(); });

const pressKey = (el, key) => act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
});

describe('GhostTextField — when it commits', () => {
    it('commits the new value on blur', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'before', onCommit });

        focus(field());
        typeInto(field(), 'after');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('after');
    });

    it('does NOT commit when the value is unchanged — blur fires on every tab-through', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'same', onCommit });

        focus(field());
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();
    });

    it('commits a single-line field on Enter', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'a', onCommit });

        focus(field());
        typeInto(field(), 'b');
        pressKey(field(), 'Enter');
        // Enter blurs; the commit rides the blur.
        await blur(field());

        expect(onCommit).toHaveBeenCalledWith('b');
    });
});

describe('GhostTextField — required fields revert rather than writing empty', () => {
    it('restores the stored value and issues no write', async () => {
        // `instructions.name` and `.content` are NOT NULL. An emptied field is a
        // select-all-delete, not an instruction to store ''.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'keep me', onCommit, required: true });

        focus(field());
        typeInto(field(), '   ');
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();
        expect(field().value).toBe('keep me');
    });

    it('still writes an empty value when the field is NOT required', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: '7', onCommit });

        focus(field());
        typeInto(field(), '');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('');
    });
});

describe('GhostTextField — an invalid value is blocked, not silently dropped', () => {
    const validate = (text) => (text === 'taken' ? 'That name is already in use.' : null);

    it('keeps the dirty text on screen, reports the reason, and issues no write', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'free', onCommit, validate });

        focus(field());
        typeInto(field(), 'taken');
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();
        // NOT reverted: the user typed a real value and the fix is a different
        // one. Reverting would destroy their work.
        expect(field().value).toBe('taken');
        expect(message().textContent).toBe('That name is already in use.');
    });

    it('tells the parent, so a card with no Save button can still say "unsaved"', async () => {
        const onErrorChange = vi.fn();
        render({ value: 'free', onCommit: vi.fn(), validate, onErrorChange });

        focus(field());
        typeInto(field(), 'taken');
        await blur(field());

        expect(onErrorChange).toHaveBeenCalledWith('That name is already in use.');

        // ...and retracts it as soon as the value becomes writable again.
        onErrorChange.mockClear();
        typeInto(field(), 'other');
        expect(onErrorChange).toHaveBeenCalledWith(null);
    });

    it('retracts the verdict on unmount so a vanished row leaves no phantom', async () => {
        const onErrorChange = vi.fn();
        render({ value: 'free', onCommit: vi.fn(), validate, onErrorChange });
        focus(field());
        typeInto(field(), 'taken');
        await blur(field());
        onErrorChange.mockClear();

        act(() => root.render(<div />));

        expect(onErrorChange).toHaveBeenCalledWith(null);
    });
});

describe('GhostTextField — a rejected write never stays on screen', () => {
    it('reverts to the stored value when the commit rejects', async () => {
        const onCommit = vi.fn().mockRejectedValue(new Error('500'));
        render({ value: 'stored', onCommit });

        focus(field());
        typeInto(field(), 'doomed');
        await blur(field());

        expect(onCommit).toHaveBeenCalled();
        expect(field().value).toBe('stored');
    });
});

describe('GhostTextField — Escape abandons the edit', () => {
    it('restores the stored value and writes nothing', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'original', onCommit });

        focus(field());
        typeInto(field(), 'scratch');
        pressKey(field(), 'Escape');

        expect(field().value).toBe('original');

        await blur(field());
        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe('GhostTextField — re-seeding from the server', () => {
    it('picks up an external change while idle', () => {
        render({ value: 'v1', onCommit: vi.fn() });
        expect(field().value).toBe('v1');

        render({ value: 'v2', onCommit: vi.fn() });

        expect(field().value).toBe('v2');
    });

    it('does NOT clobber work in progress', () => {
        // Routine on this page, not exotic: binding an agent invalidates the
        // instruction query, so a refetch lands while a sibling field is dirty.
        render({ value: 'v1', onCommit: vi.fn() });
        focus(field());
        typeInto(field(), 'my edit');

        render({ value: 'v2', onCommit: vi.fn() });

        expect(field().value).toBe('my edit');
    });

    it('does NOT clobber a blocked value that is still being fixed', async () => {
        // Blur has already happened here, so a focus-only guard would let the
        // refetch through and throw the user's text away.
        const validate = (t) => (t === 'bad' ? 'no' : null);
        render({ value: 'v1', onCommit: vi.fn(), validate });
        focus(field());
        typeInto(field(), 'bad');
        await blur(field());

        render({ value: 'v2', onCommit: vi.fn(), validate });

        expect(field().value).toBe('bad');
    });

    it('does NOT write a stale value back when the user only parked the caret', async () => {
        // Found in code review. The re-seed effect refuses to touch a FOCUSED
        // field, so an external write landing while the user has the caret in a
        // field they are merely READING leaves text and value unequal with nothing
        // typed. Deciding to write from `text !== value` silently reverted the
        // newer value — no error, no warning, no keystroke.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'A', onCommit });

        focus(field());                       // no typing at all
        render({ value: 'B', onCommit });     // external change arrives
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();
        // ...and the newer value is adopted, since this is the re-seed the effect
        // had to skip while the field was focused.
        expect(field().value).toBe('B');
    });

    it('keeps tracking the server after a no-op blur over an identical remote value', async () => {
        // Found in code review. The user types X; the server independently comes to
        // hold X too (another tab). Blur correctly writes nothing — but if the
        // baseline is left behind, the field counts as dirty forever and never
        // accepts another server update.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'A', onCommit });
        focus(field());
        typeInto(field(), 'Z');
        render({ value: 'Z', onCommit });     // server already holds it
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();

        render({ value: 'Q', onCommit });     // a genuine later change

        expect(field().value).toBe('Q');
    });

    it('accepts a LATER external change after its own commit round-trips', async () => {
        // The regression guard. A successful commit makes text and the incoming
        // value differ until the refetch catches up; if that window is mistaken
        // for dirtiness the field silently stops tracking the server forever.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'v1', onCommit });

        focus(field());
        typeInto(field(), 'mine');
        await blur(field());
        // The invalidation returns the value this field just wrote.
        render({ value: 'mine', onCommit });
        expect(field().value).toBe('mine');

        // Now somebody else changes it.
        render({ value: 'theirs', onCommit });

        expect(field().value).toBe('theirs');
    });
});

describe('GhostTextField — normalize', () => {
    it('trims before validating, displaying and committing', async () => {
        // MySQL 8's collation is NO PAD, so "  x  " and "x" are genuinely different
        // rows under a unique key. A stored padded name would then block the clean
        // one as a collision the user cannot see.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'old', onCommit, normalize: (t) => t.trim() });

        focus(field());
        typeInto(field(), '  new  ');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('new');

        // The padding never reaches the field's resting state either: once the
        // parent's invalidation hands back what was stored, the display agrees
        // with the database rather than still showing what was typed.
        render({ value: 'new', onCommit, normalize: (t) => t.trim() });
        expect(field().value).toBe('new');
    });

    it('treats a whitespace-only change as no change at all', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'same', onCommit, normalize: (t) => t.trim() });

        focus(field());
        typeInto(field(), '  same  ');
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe('GhostTextField — controlled (draft) mode', () => {
    // Used by the template row, whose value lives in the parent. The point is that
    // there is no local copy to go stale: the parent clearing the draft after a
    // successful create must empty the field even while it holds focus.

    it('reports every keystroke to the parent instead of buffering it', () => {
        const onChangeText = vi.fn();
        render({ value: '', onChangeText, onCommit: vi.fn() });

        focus(field());
        typeInto(field(), 'typed');

        expect(onChangeText).toHaveBeenCalledExactlyOnceWith('typed');
    });

    it('empties immediately when the parent clears the draft — even while focused', () => {
        // The defect this prevents: a create fired by tabbing OUT of the sibling
        // field left THIS field holding the created row's text, which the next row
        // then silently inherited as its binding content.
        render({ value: 'bar', onChangeText: vi.fn(), onCommit: vi.fn() });
        focus(field());
        expect(field().value).toBe('bar');

        render({ value: '', onChangeText: vi.fn(), onCommit: vi.fn() });

        expect(field().value).toBe('');
    });

    it('commits on EVERY blur, so a failed create can be retried by re-blurring', async () => {
        // A draft field's "commit" is a parent-level create, not a column write, so
        // the parent decides whether there is anything to do. Gating on "did the
        // value change" would strand a failed create with no way to retry.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'unchanged', onChangeText: vi.fn(), onCommit });

        focus(field());
        await blur(field());
        focus(field());
        await blur(field());

        expect(onCommit).toHaveBeenCalledTimes(2);
    });

    it('still blocks the commit when the value is invalid', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        const validate = (t) => (t === 'taken' ? 'already exists' : null);
        render({ value: 'taken', onChangeText: vi.fn(), onCommit, validate });

        focus(field());
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();
        expect(message().textContent).toBe('already exists');
    });
});

describe('GhostTextField — outlined mode', () => {
    // Worth its own block because it is a SEPARATE RETURN, and it is the branch
    // the shipped page actually uses for three of its four fields (instruction
    // content plus both template fields). Everything above renders the ghost
    // branch, so a regression confined to this one would pass the whole file.
    //
    // The commit contract is shared code and is not re-tested here. What is NOT
    // shared is where the verdict is rendered: the ghost branch draws its own
    // <Typography testId-message>, this one hands the string to MUI's helper
    // slot. The template row has no `onErrorChange` and therefore no "unsaved"
    // chip — the helper text is the ONLY thing telling the user why the row was
    // not created, so a broken helper slot means a create that fails in silence.
    const helper = () => container.querySelector('.MuiFormHelperText-root');

    const validate = (t) => (t === 'taken' ? 'already exists' : null);

    it('renders the verdict in the helper slot and marks the field errored', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'free', onCommit, validate, outlined: true, label: 'Name' });

        expect(helper()).toBeNull();

        focus(field());
        typeInto(field(), 'taken');
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();
        expect(helper().textContent).toBe('already exists');
        expect(helper().className).toContain('Mui-error');
        // The ghost branch's own message node must NOT also be drawn.
        expect(message()).toBeNull();
    });

    it('clears the helper text once the value becomes writable', async () => {
        render({ value: 'free', onCommit: vi.fn(), validate, outlined: true });
        focus(field());
        typeInto(field(), 'taken');
        await blur(field());
        expect(helper()).not.toBeNull();

        focus(field());
        typeInto(field(), 'fine');
        await blur(field());

        expect(helper()).toBeNull();
    });

    it('shows an advisory hint without blocking the write', async () => {
        // A hint is guidance, not a schema limit — the write must still go out,
        // and the field must not be painted as errored.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({
            value: 'a', onCommit, outlined: true,
            hint: (t) => (t.length > 3 ? 'that is getting long' : null),
        });

        focus(field());
        typeInto(field(), 'abcdef');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('abcdef');
        expect(helper().textContent).toBe('that is getting long');
        expect(helper().className).not.toContain('Mui-error');
    });

    // The commit contract in this mode (blur / Escape / Enter / blocked value) is
    // pinned by the OUTLINED-mode block at the foot of this file, added alongside
    // the `e.currentTarget` fix. This block is only about the helper SLOT, which
    // that block does not read: it asserts `onErrorChange` fired, not that the
    // string reached the screen. For the template row those are different
    // questions — it passes no `onErrorChange` at all, so the helper text is its
    // only channel.
});

describe('GhostTextField — commitOnEnter is separable from multiline', () => {
    it('lets a wrapping field still commit on Enter instead of inserting a newline', async () => {
        // The instruction NAME: single-line semantically, but it has to wrap rather
        // than scroll out of sight, because a name that merely looks truncated is
        // indistinguishable from the silent truncation this page guards against.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'short', onCommit, multiline: true, commitOnEnter: true });

        focus(field());
        typeInto(field(), 'a-much-longer-name');
        pressKey(field(), 'Enter');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('a-much-longer-name');
        expect(field().value).not.toContain('\n');
    });

    it('leaves Enter alone in a prose field', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'body', onCommit, multiline: true });

        focus(field());
        pressKey(field(), 'Enter');

        // Not blurred by the keystroke, so nothing was committed.
        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe('GhostTextField — OUTLINED mode has the same commit contract as ghost mode', () => {
    // Every test above renders the DEFAULT (ghost) mode. That gap is why a real
    // data-loss bug shipped: MUI's TextField routes onBlur/onChange/onFocus to the
    // input but lets onKeyDown fall through to the root FormControl DIV, so
    // `e.currentTarget.blur()` was a silent no-op and the Escape latch stayed armed
    // — swallowing the user's NEXT edit with no error and no unsaved chip.
    const outlined = { outlined: true, label: 'Name' };

    it('commits on blur', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'before', onCommit, ...outlined });

        focus(field());
        typeInto(field(), 'after');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('after');
    });

    it('Escape reverts, actually blurs, and does NOT eat the next edit', async () => {
        // The exact regression. Step 4 is the one that used to be lost.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'original', onCommit, ...outlined });

        focus(field());
        typeInto(field(), 'scratch');
        pressKey(field(), 'Escape');

        expect(field().value).toBe('original');
        expect(document.activeElement).not.toBe(field());   // the blur really happened

        focus(field());
        typeInto(field(), 'REAL EDIT');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('REAL EDIT');
    });

    it('recovers even if the Escape blur never lands', async () => {
        // Belt and braces: if a future MUI change breaks the blur again, the next
        // keystroke disarms the latch rather than letting it swallow an edit.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'original', onCommit, ...outlined });

        focus(field());
        typeInto(field(), 'scratch');
        pressKey(field(), 'Escape');
        // Simulate the old broken world: still focused, user keeps typing.
        focus(field());
        pressKey(field(), 'a');
        typeInto(field(), 'REAL EDIT');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('REAL EDIT');
    });

    it('commitOnEnter actually commits in outlined mode', async () => {
        // Was inert for the same reason: preventDefault fired on a div and the
        // blur no-oped, so Enter did nothing at all on the template Name field.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: 'a', onCommit, ...outlined, commitOnEnter: true });

        focus(field());
        typeInto(field(), 'b');
        pressKey(field(), 'Enter');
        await act(async () => {});

        expect(document.activeElement).not.toBe(field());
        expect(onCommit).toHaveBeenCalledExactlyOnceWith('b');
    });

    it('blocks an invalid value and reports it, exactly as ghost mode does', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        const onErrorChange = vi.fn();
        const validate = (t) => (t === 'taken' ? 'already exists' : null);
        render({ value: 'free', onCommit, validate, onErrorChange, ...outlined });

        focus(field());
        typeInto(field(), 'taken');
        await blur(field());

        expect(onCommit).not.toHaveBeenCalled();
        expect(field().value).toBe('taken');
        expect(onErrorChange).toHaveBeenCalledWith('already exists');
    });
});
