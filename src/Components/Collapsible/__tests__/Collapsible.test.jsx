// @vitest-environment jsdom
//
// Req #3572 — long text in an Agents list sits collapsed, and a click discloses it.
//
// jsdom does no layout, so scrollHeight and clientHeight are both 0 and nothing
// ever "overflows". The tests stub the two getters: tall content (scrollHeight
// 400) inside a short box (clientHeight 80) is what a clamped long text measures
// as in a browser, and the stub is switched off to model short text.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

import CollapsibleText from '../CollapsibleText';
import CollapsibleGhostField from '../../GhostField/CollapsibleGhostField';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let overflow;

const stub = (prop, fn) => Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true, get: fn,
});

beforeEach(() => {
    overflow = true;
    stub('scrollHeight', () => (overflow ? 400 : 80));
    stub('clientHeight', () => 80);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete HTMLElement.prototype.scrollHeight;
    delete HTMLElement.prototype.clientHeight;
});

const render = (el) => act(() => root.render(el));
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('CollapsibleText', () => {
    it('starts collapsed with a Show more toggle when the text overflows', () => {
        render(<CollapsibleText text={'long\n'.repeat(50)} testId="t" />);
        expect(q('t').dataset.collapsed).toBe('true');
        expect(q('t-toggle').textContent).toBe('Show more');
    });

    it('expands on a click of the clamped text, and collapses only from the toggle', () => {
        render(<CollapsibleText text={'long\n'.repeat(50)} testId="t" />);
        click(q('t'));
        expect(q('t').dataset.collapsed).toBe('false');
        expect(q('t-toggle').textContent).toBe('Show less');
        // Clicking expanded text (e.g. to select a passage) must not snap it shut.
        click(q('t'));
        expect(q('t').dataset.collapsed).toBe('false');
        click(q('t-toggle'));
        expect(q('t').dataset.collapsed).toBe('true');
    });

    it('renders the toggle ABOVE overflowing text', () => {
        render(<CollapsibleText text={'long\n'.repeat(50)} testId="t" />);
        // DOCUMENT_POSITION_FOLLOWING: the text comes after the toggle.
        expect(q('t-toggle').compareDocumentPosition(q('t')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders NO toggle for text that fits (req #4144)', () => {
        overflow = false;
        render(<CollapsibleText text="short" testId="t" />);
        expect(q('t-toggle')).toBeNull();
        // Short text is not click-to-expand: there is nothing to disclose.
        expect(q('t').dataset.collapsed).toBe('false');
        expect(q('t').textContent).toBe('short');
    });
});

describe('CollapsibleGhostField', () => {
    const field = (props = {}) => (
        <CollapsibleGhostField value={'line\n'.repeat(40)} outlined multiline
                               onCommit={vi.fn()} testId="f" {...props} />
    );
    // The visible textarea carries the testid; MUI's hidden shadow one does not.
    const rows = () => q('f');

    it('collapses to collapsedRows, with the full value still in the field', () => {
        render(field({ collapsedRows: 3 }));
        expect(q('f-toggle').textContent).toBe('Show more');
        expect(rows().value).toBe('line\n'.repeat(40));
    });

    it('renders no toggle when the collapsed field hides nothing (req #4144)', () => {
        overflow = false;
        render(field({ value: 'short' }));
        expect(q('f-toggle')).toBeNull();
    });

    it('a field that starts open and fits loses its toggle once collapsed (req #4144)', () => {
        overflow = false;
        render(field({ value: 'short', defaultExpanded: true }));
        expect(q('f-toggle').textContent).toBe('Show less');
        click(q('f-toggle'));
        expect(q('f-toggle')).toBeNull();
    });

    it('the toggle pins it open and shut', () => {
        render(field());
        click(q('f-toggle'));
        expect(q('f-toggle').textContent).toBe('Show less');
        click(q('f-toggle'));
        expect(q('f-toggle').textContent).toBe('Show more');
    });

    it('focusing the field expands it; blurring re-collapses it', () => {
        const onEditingChange = vi.fn();
        render(field({ onEditingChange }));
        act(() => { rows().focus(); });
        expect(q('f-toggle').textContent).toBe('Show less');
        expect(onEditingChange).toHaveBeenLastCalledWith(true);
        act(() => { rows().blur(); });
        expect(q('f-toggle').textContent).toBe('Show more');
        expect(onEditingChange).toHaveBeenLastCalledWith(false);
    });

    it('defaultExpanded opens it pinned', () => {
        render(field({ defaultExpanded: true }));
        expect(q('f-toggle').textContent).toBe('Show less');
    });



    // A blur caused by pressing on something BELOW the field must not shrink the
    // field before that press's click lands, or the click is lost.
    it('a pointer blur collapses only after the gesture completes', () => {
        vi.useFakeTimers();
        try {
            render(field());
            act(() => { rows().focus(); });
            act(() => {
                window.dispatchEvent(new Event('pointerdown'));
                rows().blur();
            });
            expect(q('f-toggle').textContent).toBe('Show less');   // still open
            act(() => { window.dispatchEvent(new Event('pointerup')); });
            expect(q('f-toggle').textContent).toBe('Show less');   // click not yet landed
            act(() => { vi.runAllTimers(); });
            expect(q('f-toggle').textContent).toBe('Show more');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a press INSIDE the field does not defer a later keyboard blur', () => {
        render(field());
        act(() => { rows().focus(); });
        act(() => {
            window.dispatchEvent(new Event('pointerdown'));
            window.dispatchEvent(new Event('pointerup'));
        });
        act(() => { rows().blur(); });
        expect(q('f-toggle').textContent).toBe('Show more');
    });

    it('an untouched focus-and-blur (reading) writes nothing', () => {
        const onCommit = vi.fn();
        render(field({ onCommit }));
        act(() => { rows().focus(); });
        act(() => { rows().blur(); });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('renders the toggle ABOVE a field that overflows', () => {
        render(field());
        const toggle = q('f-toggle');
        expect(toggle.textContent).toBe('Show more');
        expect(toggle.compareDocumentPosition(rows()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
