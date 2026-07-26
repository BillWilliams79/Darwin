// @vitest-environment jsdom
//
// Req #3073 — what the Maps migration added to the shared field, kept in a sibling
// file so GhostTextField.test.jsx stays the untouched behavioural spec from #3063.
//
// The important half of this file is the stale-prop latch. Everything else here is a
// presentation prop; that one is a correctness fix to the commit contract itself, and
// it applies to every consumer, not just Maps.

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

const typeInto = (el, value) => act(() => {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
});

const focus = (el) => act(() => el.focus());
const blur = (el) => act(async () => { el.blur(); });

// A normalizer that rewrites the text is what makes the stale-prop window visible:
// the field's own value changes at commit time, so the re-seed effect re-runs while
// the `value` prop is still the pre-write one.
const oneDecimal = (t) => {
    const n = Number(t);
    return Number.isFinite(n) ? n.toFixed(1) : t;
};

describe('GhostTextField — a committed value survives until the prop catches up', () => {
    it('does NOT repaint the pre-write value after a successful commit', async () => {
        // The caller invalidates its query on success, but that round trip takes a
        // network hop. Until it lands, `value` is still what it was before the write.
        // Repainting it there undoes the user's edit in front of them, reads as a
        // failed save, and the retry it invites writes the same value twice.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: '12.5', onCommit, normalize: oneDecimal });

        focus(field());
        typeInto(field(), '20');
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('20.0');
        expect(field().value).toBe('20.0');
    });

    it('holds the committed value across an unrelated re-render', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: '12.5', onCommit, normalize: oneDecimal });

        focus(field());
        typeInto(field(), '20');
        await blur(field());

        render({ value: '12.5', onCommit, normalize: oneDecimal, placeholder: 'x' });
        expect(field().value).toBe('20.0');
    });

    it('does not undo the edit when the user clicks back in and straight out', async () => {
        // Which is exactly how somebody checks that an edit took.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: '12.5', onCommit, normalize: oneDecimal });

        focus(field());
        typeInto(field(), '20');
        await blur(field());

        focus(field());
        await blur(field());

        expect(onCommit).toHaveBeenCalledExactlyOnceWith('20.0');
        expect(field().value).toBe('20.0');
    });

    it('adopts the prop as soon as it moves', async () => {
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: '12.5', onCommit, normalize: oneDecimal });

        focus(field());
        typeInto(field(), '20');
        await blur(field());

        render({ value: '20.0', onCommit, normalize: oneDecimal });
        expect(field().value).toBe('20.0');

        // ...and the latch is released, so a later external change still lands.
        render({ value: '31.4', onCommit, normalize: oneDecimal });
        expect(field().value).toBe('31.4');
    });

    it('releases the latch when the write is refused', async () => {
        const onCommit = vi.fn().mockRejectedValue(new Error('500'));
        render({ value: '12.5', onCommit, normalize: oneDecimal });

        focus(field());
        typeInto(field(), '20');
        await blur(field());

        expect(field().value).toBe('12.5');

        render({ value: '31.4', onCommit, normalize: oneDecimal });
        expect(field().value).toBe('31.4');
    });

    it('still adopts a genuinely newer value that arrives while the field holds focus', async () => {
        // The latch must not swallow the case it was carved out of: nothing typed,
        // no write outstanding, and the server moved underneath a parked caret.
        const onCommit = vi.fn().mockResolvedValue(undefined);
        render({ value: '12.5', onCommit, normalize: oneDecimal });

        focus(field());
        render({ value: '31.4', onCommit, normalize: oneDecimal });
        expect(field().value).toBe('12.5');       // refused to re-seed a focused field

        await blur(field());
        expect(onCommit).not.toHaveBeenCalled();  // nothing was typed
        expect(field().value).toBe('31.4');       // adopted on the way out
    });
});

describe('GhostTextField — type', () => {
    it('reaches the input', () => {
        render({ value: '2026-03-15T11:30', onCommit: vi.fn(), type: 'datetime-local' });
        expect(field().getAttribute('type')).toBe('datetime-local');
    });

    it('is suppressed on a multiline field, where it is invalid DOM', () => {
        render({ value: 'prose', onCommit: vi.fn(), multiline: true, type: 'datetime-local' });
        expect(field().tagName).toBe('TEXTAREA');
        expect(field().hasAttribute('type')).toBe(false);
    });

    it('leaves the default to InputBase rather than forcing one', () => {
        // The prop defaults to undefined so that MUI decides — which is what makes
        // the multiline suppression above possible at all.
        render({ value: 'a', onCommit: vi.fn() });
        expect(field().getAttribute('type')).toBe('text');
    });
});

describe('GhostTextField — inline and overlayMessage', () => {
    const wrapper = () => field().closest('.MuiInputBase-root').parentElement;

    // `sx` compiles to an emotion class, not an inline style, so the rules have to
    // be read back off the stylesheet emotion injected rather than off el.style.
    const styleOf = (el) => window.getComputedStyle(el);

    it('lays a normal field out as a block', () => {
        render({ value: 'a', onCommit: vi.fn() });
        expect(styleOf(wrapper()).display).not.toBe('inline-flex');
    });

    it('lays an inline field out as a flex COLUMN, so its baseline is the input\'s', () => {
        // An inline-block would baseline on its LAST line box, so a trailing unit
        // beside the field would jump the moment a verdict appeared beneath it.
        render({ value: 'a', onCommit: vi.fn(), inline: true });
        expect(styleOf(wrapper()).display).toBe('inline-flex');
        expect(styleOf(wrapper()).flexDirection).toBe('column');
        expect(styleOf(wrapper()).verticalAlign).toBe('baseline');
    });

    it('ignores inline on a multiline field, which is a block of text by definition', () => {
        render({ value: 'a', onCommit: vi.fn(), inline: true, multiline: true });
        expect(styleOf(wrapper()).display).not.toBe('inline-flex');
    });

    it('keeps the verdict in flow by default', () => {
        render({ value: 'a', onCommit: vi.fn(), validate: () => 'nope' });
        focus(field());
        typeInto(field(), 'b');
        expect(styleOf(message()).position).toBe('');
    });

    it('takes the verdict out of flow when asked, so it cannot widen the field', () => {
        render({ value: 'a', onCommit: vi.fn(), validate: () => 'nope', overlayMessage: true });
        focus(field());
        typeInto(field(), 'b');
        expect(styleOf(message()).position).toBe('absolute');
        expect(styleOf(wrapper()).position).toBe('relative');
    });
});
