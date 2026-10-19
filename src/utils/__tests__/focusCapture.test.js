// @vitest-environment jsdom
//
// req #3652 — a live focus event becomes one block to paste to Claude: the
// app-wide timeline, the persisted losses, and the Ctrl+Shift+F capture.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { installFocusCapture, buildFocusCapture, copyFocusCapture } from '../focusCapture';
import { watchFocusLoss, focusTimeline, storedFocusLosses } from '../focusLossRecorder';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

const tick = () => new Promise((r) => setTimeout(r, 0));
const parse = (text) => JSON.parse(text.split('```json\n')[1].split('\n```')[0]);
const keydown = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

let writeText;

beforeAll(() => { installFocusCapture(); });

beforeEach(() => {
    document.body.innerHTML = `
        <div data-testid="category-card-5">
            <div data-testid="requirement-template"><textarea name="title"></textarea></div>
        </div>
        <button data-testid="elsewhere">x</button>`;
    window.localStorage.clear();
    window.__darwinFocusLoss = [];
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    useSnackBarStore.setState({ open: false, message: '', action: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('focus timeline (req #3652)', () => {
    it('records focus moves and key classes app-wide, never the typed text', () => {
        const since = Date.now();
        const field = document.querySelector('textarea');
        field.focus();
        keydown(field, { key: 's' });
        keydown(field, { key: 'Backspace' });
        keydown(field, { key: 'v', metaKey: true });
        document.querySelector('[data-testid="elsewhere"]').focus();

        const events = focusTimeline(since);
        expect(events.map((e) => e.type)).toEqual(['focusin', 'keydown', 'keydown', 'keydown', 'focusout', 'focusin']);
        expect(events[0].target).toBe('textarea[testid=requirement-template][name=title]');
        expect(events.slice(1, 4).map((e) => e.key)).toEqual(['char', 'Backspace', 'Meta+v']);
        expect(events[4].to).toBe('button[testid=elsewhere]');
        expect(JSON.stringify(events)).not.toContain('"s"');
    });

    it('never records a character typed with Option/AltGr, or an emoji', () => {
        const since = Date.now();
        const field = document.querySelector('textarea');
        field.focus();
        keydown(field, { key: 'å', altKey: true });
        keydown(document.body, { key: '@', ctrlKey: true, altKey: true });
        keydown(document.body, { key: '😀' });

        const keys = focusTimeline(since).filter((e) => e.type === 'keydown');
        // The two on <body> are one run of typing; the field's is its own.
        expect(keys.map((e) => e.key)).toEqual(['char', 'char']);
        expect(keys[1].count).toBe(2);
        const text = JSON.stringify(keys);
        for (const typed of ['å', '@', '😀']) expect(text).not.toContain(typed);
    });

    it('folds a run of typing into one entry, so the focusing click survives in a loss report', async () => {
        const field = document.querySelector('textarea');
        const stop = watchFocusLoss(field, { label: 'template title (Cat)' });
        try {
            field.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            field.focus();
            for (let i = 0; i < 60; i += 1) keydown(field, { key: 'x' });
            document.querySelector('[data-testid="elsewhere"]').focus();
            await tick();

            const [report] = window.__darwinFocusLoss;
            // The 2 s lead also reaches earlier tests' entries — judge from the press on.
            const press = report.timeline.findLastIndex((e) => e.type === 'pointerdown');
            expect(press).toBeGreaterThanOrEqual(0);
            const typing = report.timeline.slice(press).filter((e) => e.key === 'char');
            expect(typing).toHaveLength(1);
            expect(typing[0].count).toBe(60);
        } finally {
            stop();
        }
    });

    it('attaches the timeline around the session to a loss, and persists the loss', async () => {
        const field = document.querySelector('textarea');
        const stop = watchFocusLoss(field, { label: 'template title (Cat)' });
        try {
            field.focus();
            document.querySelector('[data-testid="elsewhere"]').focus();
            await tick();

            const [report] = window.__darwinFocusLoss;
            expect(report.cause).toBe('focus-stolen');
            expect(report.timeline.some((e) => e.type === 'focusin' && e.target.startsWith('textarea'))).toBe(true);
            expect(report.timeline.every((e) => typeof e.atMs === 'number' && !('t' in e))).toBe(true);
            expect(storedFocusLosses()).toHaveLength(1);
            expect(storedFocusLosses()[0].at).toBe(report.at);
        } finally {
            stop();
        }
    });
});

describe('focus capture (req #3652)', () => {
    it('says what it is and carries where focus is, the build, the losses and the timeline', () => {
        const earlier = new Date(Date.now() - 60000).toISOString();
        window.localStorage.setItem('darwinFocusLoss', JSON.stringify([{ at: earlier, cause: 'remounted' }]));
        const field = document.querySelector('textarea');
        field.value = 'half a title';
        field.focus();
        field.setSelectionRange(4, 4);

        const text = buildFocusCapture({ reason: 'test' });
        expect(text.startsWith('Darwin focus capture — paste this whole block to Claude.')).toBe(true);
        const capture = parse(text);
        expect(capture.reason).toBe('test');
        // The vite define, not the 'unknown' fallback (vitest runs the config).
        expect(capture.build.commit).toMatch(/^[0-9a-f]{12}(\+dirty)?$/);
        expect(capture.activeElement).toMatchObject({
            element: 'textarea[testid=requirement-template][name=title]',
            testidPath: ['requirement-template', 'category-card-5'],
            caret: 4, valueLength: 12, disabled: false, connected: true,
        });
        expect(capture.losses).toEqual([{ at: earlier, cause: 'remounted' }]);
        expect(capture.timeline.length).toBeGreaterThan(0);
        expect(capture.timeline.every((e) => e.msAgo >= 0)).toBe(true);
        expect(text).not.toContain('half a title');
    });

    it('Ctrl+Shift+F copies a capture taken where focus is at that moment', async () => {
        const field = document.querySelector('textarea');
        field.focus();
        const event = new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
        field.dispatchEvent(event);
        await tick();

        expect(event.defaultPrevented).toBe(true);
        expect(writeText).toHaveBeenCalledTimes(1);
        const capture = parse(writeText.mock.calls[0][0]);
        expect(capture.reason).toBe('hotkey Ctrl+Shift+F');
        expect(capture.activeElement.element).toBe('textarea[testid=requirement-template][name=title]');
        expect(capture.timeline.at(-1)).toMatchObject({ type: 'keydown', key: 'Ctrl+Shift+F' });
        expect(useSnackBarStore.getState().message).toBe('Focus capture copied — paste it to Claude.');
        expect(window.__darwinFocusCapture).toBe(writeText.mock.calls[0][0]);
    });

    it('carries the alerted loss even when localStorage refused it', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
        const field = document.querySelector('textarea');
        const stop = watchFocusLoss(field, { label: 'template title (Cat)' });
        try {
            field.focus();
            document.querySelector('[data-testid="elsewhere"]').focus();
            await tick();
        } finally {
            stop();
        }
        const [report] = window.__darwinFocusLoss;
        expect(storedFocusLosses()).toHaveLength(0);
        const capture = parse(buildFocusCapture({ reason: 'focus-loss alert', report }));
        expect(capture.alertedLoss).toBe(report.at);
        expect(capture.losses.map((l) => l.at)).toEqual([report.at]);
        expect(capture.activeElement.note).toContain('alertedLoss');
    });

    it('leaves out losses older than a day', () => {
        const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const recent = new Date().toISOString();
        window.localStorage.setItem('darwinFocusLoss', JSON.stringify([{ at: old }, { at: recent }]));
        expect(parse(buildFocusCapture({ reason: 'test' })).losses).toEqual([{ at: recent }]);
    });

    it('fires once while the chord is held down', async () => {
        const held = new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true, repeat: true, bubbles: true, cancelable: true });
        document.body.dispatchEvent(held);
        await tick();
        expect(writeText).not.toHaveBeenCalled();
    });

    it('leaves other chords alone', async () => {
        const event = new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);
        await tick();
        expect(event.defaultPrevented).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
    });

    it('says how to get the capture when the clipboard refuses', async () => {
        writeText.mockImplementation(() => Promise.reject(new Error('denied')));
        expect(await copyFocusCapture({ reason: 'test' })).toBe(false);
        expect(useSnackBarStore.getState().message).toContain('copy(__darwinFocusCapture)');
        expect(window.__darwinFocusCapture).toContain('paste this whole block to Claude');
    });

    it('is reachable from DevTools', () => {
        expect(parse(window.darwinFocusCapture()).reason).toBe('devtools');
    });
});
