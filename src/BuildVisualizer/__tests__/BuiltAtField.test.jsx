// @vitest-environment jsdom
//
// req #3515 — BuiltAtField, the build card's built_at editor. Stored UTC, edited
// in Pacific. Commits on blur / Enter only when the value changed; Escape
// reverts; clearing commits null (the page PUTs the "NULL" sentinel).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import BuiltAtField from '../BuiltAtField';

afterEach(cleanup);

const input = () => screen.getByTestId('bv-menu-built-at-input');

describe('BuiltAtField (req #3515)', () => {
    it('shows the stored UTC value as Pacific wall time', () => {
        render(<BuiltAtField value="2026-09-16 02:00:00.000000" onCommit={() => {}} />);
        expect(input().value).toBe('2026-09-15T19:00');
    });

    it('is empty for a NULL built_at', () => {
        render(<BuiltAtField value={null} onCommit={() => {}} />);
        expect(input().value).toBe('');
    });

    it('commits the UTC literal on blur after an edit', () => {
        const onCommit = vi.fn();
        render(<BuiltAtField value="2026-09-14 14:00:00" onCommit={onCommit} />);
        fireEvent.change(input(), { target: { value: '2026-09-14T19:00' } });
        fireEvent.blur(input());
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith('2026-09-15 02:00:00');
    });

    it('commits on Enter', () => {
        const onCommit = vi.fn();
        render(<BuiltAtField value={null} onCommit={onCommit} />);
        fireEvent.change(input(), { target: { value: '2026-09-14T07:00' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(onCommit).toHaveBeenCalledWith('2026-09-14 14:00:00');
    });

    it('does not commit when nothing changed (seconds on the stored value ignored)', () => {
        const onCommit = vi.fn();
        render(<BuiltAtField value="2026-09-14 14:00:30" onCommit={onCommit} />);
        fireEvent.blur(input());
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('clearing the input commits null', () => {
        const onCommit = vi.fn();
        render(<BuiltAtField value="2026-09-14 14:00:00" onCommit={onCommit} />);
        fireEvent.change(input(), { target: { value: '' } });
        fireEvent.blur(input());
        expect(onCommit).toHaveBeenCalledWith(null);
    });

    it('Escape reverts the draft to the stored value', () => {
        const onCommit = vi.fn();
        render(<BuiltAtField value="2026-09-14 14:00:00" onCommit={onCommit} />);
        fireEvent.change(input(), { target: { value: '2026-01-01T00:00' } });
        fireEvent.keyDown(input(), { key: 'Escape' });
        expect(input().value).toBe('2026-09-14T07:00');
        fireEvent.blur(input());
        expect(onCommit).not.toHaveBeenCalled();
    });

    // Code review (req #3515): a datetime-local with an incomplete set of segments
    // reports value === '' AND validity.badInput. Treating that as a clear wiped a
    // stored build date when the user backspaced the hour and clicked away.
    it('a half-typed value never clears the stored date', () => {
        const onCommit = vi.fn();
        render(<BuiltAtField value="2026-09-18 14:00:00" onCommit={onCommit} />);
        const el = input();
        // jsdom keeps validity.badInput false for a datetime-local, so the flag is
        // forced here — this is the browser behaviour the guard exists for.
        Object.defineProperty(el, 'validity', { value: { badInput: true }, configurable: true });
        fireEvent.change(el, { target: { value: '' } });
        fireEvent.blur(el);
        expect(onCommit).not.toHaveBeenCalled();
        expect(el.value).toBe('2026-09-18T07:00');   // reverted to the stored time
    });

    it('a rejected save reverts the field instead of showing an unsaved value', async () => {
        const onCommit = vi.fn().mockRejectedValue(new Error('PUT failed'));
        render(<BuiltAtField value="2026-09-18 14:00:00" onCommit={onCommit} />);
        fireEvent.change(input(), { target: { value: '2026-09-18T09:00' } });
        fireEvent.blur(input());
        await waitFor(() => expect(input().value).toBe('2026-09-18T07:00'));
        expect(onCommit).toHaveBeenCalledWith('2026-09-18 16:00:00');
    });

    it('re-syncs the draft when the stored value changes (refetch / another build)', () => {
        const { rerender } = render(<BuiltAtField value="2026-09-14 14:00:00" onCommit={() => {}} />);
        rerender(<BuiltAtField value="2026-09-27 14:00:00" onCommit={() => {}} />);
        expect(input().value).toBe('2026-09-27T07:00');
    });

    // Test Architect gap closure. The "unchanged" check normalizes the STORED
    // value through the same Pacific round trip as the draft. That matters on the
    // fall-back night: a stored 09:30 UTC (1:30 AM PST) displays as 01:30, and
    // 01:30 converts back to 08:30 UTC (PDT). Compared raw, a mere focus-and-blur
    // would silently move the build an hour.
    it('a stored second-occurrence fall-back time is not rewritten by a bare blur', () => {
        const onCommit = vi.fn();
        render(<BuiltAtField value="2026-11-01 09:30:00" onCommit={onCommit} />);
        expect(input().value).toBe('2026-11-01T01:30');
        fireEvent.blur(input());
        fireEvent.keyDown(input(), { key: 'Enter' });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('commits at most once per edit (blur after Enter does not double-write)', () => {
        const onCommit = vi.fn();
        const { rerender } = render(<BuiltAtField value="2026-09-14 14:00:00" onCommit={onCommit} />);
        fireEvent.change(input(), { target: { value: '2026-09-14T08:00' } });
        fireEvent.keyDown(input(), { key: 'Enter' });
        // The page's PUT lands and the refetch hands the new value back.
        rerender(<BuiltAtField value="2026-09-14 15:00:00" onCommit={onCommit} />);
        fireEvent.blur(input());
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith('2026-09-14 15:00:00');
    });

    it('disabled renders a disabled input', () => {
        render(<BuiltAtField value="2026-09-14 14:00:00" onCommit={() => {}} disabled />);
        expect(input().disabled).toBe(true);
    });
});
