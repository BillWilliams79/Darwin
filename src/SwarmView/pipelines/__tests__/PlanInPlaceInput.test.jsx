// @vitest-environment jsdom
//
// Req #3580 — the Plan visualizer's in-place name editor. The commit rules are
// the part worth pinning: Enter and blur commit, Escape cancels, and only the
// FIRST of those counts (an Enter unmounts the editor, which blurs it — a
// second commit there would write twice). The `data-viz-chrome` marker is what
// keeps d3's pan and the canvas hit-test off the input, so it is asserted too.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

import PlanInPlaceInput, { titleProblem } from '../PlanInPlaceInput';

afterEach(cleanup);

const mount = (props = {}) => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const utils = render(
        <PlanInPlaceInput initial="Old name" onCommit={onCommit} onCancel={onCancel}
                          testId="ed" ariaLabel="Rename" {...props} />);
    return { ...utils, input: utils.getByTestId('ed'), onCommit, onCancel };
};

describe('PlanInPlaceInput (req #3580)', () => {
    it('opens focused on the current name, marked as canvas chrome', () => {
        const { input } = mount();
        expect(input.value).toBe('Old name');
        expect(document.activeElement).toBe(input);
        expect(input.getAttribute('data-viz-chrome')).toBe('edit');
        expect(input.getAttribute('maxlength')).toBe('256');
    });

    it('Enter commits the typed value exactly once, even when blur follows', () => {
        const { input, onCommit, onCancel } = mount();
        fireEvent.change(input, { target: { value: 'New name' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.blur(input);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith('New name');
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('blur commits', () => {
        const { input, onCommit } = mount();
        fireEvent.change(input, { target: { value: 'Blurred' } });
        fireEvent.blur(input);
        expect(onCommit).toHaveBeenCalledWith('Blurred');
    });

    it('Escape cancels and the blur after it does not commit', () => {
        const { input, onCommit, onCancel } = mount();
        fireEvent.change(input, { target: { value: 'Discard me' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        fireEvent.blur(input);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('keeps its keystrokes to itself (Space must not reach a chip handler)', () => {
        const parentKey = vi.fn();
        const onCommit = vi.fn();
        const { getByTestId } = render(
            <div onKeyDown={parentKey}>
                <PlanInPlaceInput initial="x" onCommit={onCommit} onCancel={() => {}}
                                  testId="ed" />
            </div>);
        fireEvent.keyDown(getByTestId('ed'), { key: ' ' });
        expect(parentKey).not.toHaveBeenCalled();
    });

    it('commits what was typed when the canvas removes it without an Enter or blur', async () => {
        const { input, onCommit, unmount } = mount();
        fireEvent.change(input, { target: { value: 'Typed then zoomed away' } });
        unmount();
        await new Promise((r) => setTimeout(r, 5));
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith('Typed then zoomed away');
    });

    it('does not commit again on removal after Escape or Enter already ended it', async () => {
        const a = mount();
        fireEvent.keyDown(a.input, { key: 'Escape' });
        a.unmount();
        const b = mount();
        fireEvent.keyDown(b.input, { key: 'Enter' });
        b.unmount();
        await new Promise((r) => setTimeout(r, 5));
        expect(a.onCommit).not.toHaveBeenCalled();
        expect(b.onCommit).toHaveBeenCalledTimes(1);
    });

    it('ignores the Enter that confirms an input-method composition', () => {
        const { input, onCommit } = mount();
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('grows with what is typed when asked to', () => {
        const { input } = mount({ growCh: true, style: { fontSize: 12 } });
        fireEvent.change(input, { target: { value: 'x'.repeat(40) } });
        expect(input.style.width).toBe('42ch');
        expect(input.style.fontSize).toBe('12px');
    });

    it('goes read-only while saving', () => {
        const { input } = mount({ saving: true });
        expect(input.readOnly).toBe(true);
        expect(input.getAttribute('aria-busy')).toBe('true');
    });
});

describe('titleProblem (req #3580)', () => {
    it('refuses an empty title and the REST NULL sentinel, accepts anything else', () => {
        expect(titleProblem('')).toMatch(/required/);
        expect(titleProblem('NULL')).toMatch(/sentinel/);
        expect(titleProblem('Null')).toBeNull();
        expect(titleProblem('A real name')).toBeNull();
    });
});
