// @vitest-environment jsdom
//
// req #3632 — the focus-loss recorder must name the culprit when focus is
// TAKEN from a watched field, and stay silent when the reader moves it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { watchFocusLoss } from '../focusLossRecorder';

const tick = () => new Promise((r) => setTimeout(r, 0));
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const press = (el, type = 'pointerdown', init = {}) => {
    const e = new Event(type, { bubbles: true });
    Object.assign(e, init);
    el.dispatchEvent(e);
};

let wrapper, field, other, plain, onLoss, stop;
const nativeFocus = HTMLElement.prototype.focus;
const nativeBlur = HTMLElement.prototype.blur;

beforeEach(() => {
    document.body.innerHTML = `
        <div data-testid="category-card-5">
            <div data-testid="requirement-template"><textarea name="title"></textarea></div>
        </div>
        <button data-testid="elsewhere">x</button>
        <div data-testid="plain-text">not focusable</div>`;
    wrapper = document.querySelector('[data-testid="requirement-template"]');
    field = wrapper.querySelector('textarea');
    other = document.querySelector('[data-testid="elsewhere"]');
    plain = document.querySelector('[data-testid="plain-text"]');
    onLoss = vi.fn();
    window.__darwinFocusLoss = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stop = watchFocusLoss(field, { label: 'template title (Cat)', onLoss });
});

afterEach(() => {
    stop();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '';
});

describe('focusLossRecorder — causes (req #3632)', () => {
    it('names a programmatic focus steal and the code that made it', async () => {
        field.focus();
        function errantFocusTaker() { other.focus(); }
        errantFocusTaker();
        await tick();

        expect(onLoss).toHaveBeenCalledTimes(1);
        const report = onLoss.mock.calls[0][0];
        expect(report.cause).toBe('focus-stolen');
        expect(report.label).toBe('template title (Cat)');
        expect(report.takenBy).toBe('button[testid=elsewhere]');
        expect(report.culprit).toBe('button[testid=elsewhere]');
        expect(report.focusCalls[0].target).toBe('button[testid=elsewhere]');
        expect(report.focusCalls[0].stack.join('\n')).toContain('errantFocusTaker');
        expect(report.alerted).toBe(true);
        expect(window.__darwinFocusLoss).toHaveLength(1);
        expect(JSON.parse(window.darwinFocusLossReport())[0].cause).toBe('focus-stolen');
    });

    it('reports a remount and names the parent that removed the field', async () => {
        field.focus();
        wrapper.parentElement.removeChild(wrapper);
        await tick();

        expect(onLoss).toHaveBeenCalledTimes(1);
        const report = onLoss.mock.calls[0][0];
        expect(report.cause).toBe('remounted');
        expect(report.mutations[0]).toMatchObject({
            kind: 'removed', node: 'div[testid=requirement-template]', from: 'div[testid=category-card-5]',
        });
        expect(report.culprit).toBe('div[testid=requirement-template] removed from div[testid=category-card-5]');
    });

    it('reports a remount when the unmount cleanup runs before the observer does', () => {
        field.focus();
        wrapper.parentElement.removeChild(wrapper);
        stop();   // React: DOM detached, then passive-effect cleanup

        expect(onLoss).toHaveBeenCalledTimes(1);
        expect(onLoss.mock.calls[0][0].cause).toBe('remounted');
    });

    it('reports a field taken out and put back as moved', async () => {
        field.focus();
        const card = wrapper.parentElement;
        card.removeChild(wrapper);
        card.appendChild(wrapper);
        field.dispatchEvent(new FocusEvent('blur'));
        other.focus();   // jsdom does not drop focus on removal; settle it elsewhere
        await tick();

        expect(onLoss.mock.calls[0][0].cause).toBe('moved');
    });

    it('reports a hidden ancestor as the cause', async () => {
        field.focus();
        wrapper.parentElement.hidden = true;
        field.blur();   // jsdom does not drop focus itself; the browser would
        await tick();

        const report = onLoss.mock.calls[0][0];
        expect(report.cause).toBe('hidden');
        expect(report.hiddenBy).toBe('div[testid=category-card-5]');
        expect(report.culprit).toBe('hidden by div[testid=category-card-5]');
    });

    it('does not treat aria-hidden as hidden — a dialog steal is still a steal', async () => {
        field.focus();
        wrapper.parentElement.setAttribute('aria-hidden', 'true');   // what MUI Modal does to #root
        other.focus();
        await tick();

        expect(onLoss.mock.calls[0][0].cause).toBe('focus-stolen');
    });

    it('reports the field becoming disabled', async () => {
        field.focus();
        field.disabled = true;
        // Chrome blurs a field the moment it is disabled; jsdom does not.
        field.dispatchEvent(new FocusEvent('blur'));
        nativeFocus.call(other);
        await tick();

        expect(onLoss.mock.calls[0][0].cause).toBe('disabled');
    });

    it('reports a script blurring the field', async () => {
        field.focus();
        function blurrer() { field.blur(); }
        blurrer();
        await tick();

        const report = onLoss.mock.calls[0][0];
        expect(report.cause).toBe('blur-called');
        expect(report.blurCalls[0].stack.join('\n')).toContain('blurrer');
    });

    it('reports focus landing elsewhere with no script call as focus-moved', async () => {
        field.focus();
        // A focus change no script made: blur arrives naming where focus went.
        HTMLElement.prototype.focus.call(field);   // keep the wrapper honest: self-focus is not a steal
        field.dispatchEvent(new FocusEvent('blur', { relatedTarget: other }));
        nativeFocus.call(other);
        await tick();

        expect(onLoss.mock.calls[0][0].cause).toBe('focus-moved');
        expect(onLoss.mock.calls[0][0].relatedTarget).toBe('button[testid=elsewhere]');
    });
});

describe('focusLossRecorder — reader intent (req #3632)', () => {
    it('stays silent when the reader presses elsewhere first', async () => {
        field.focus();
        press(other);
        other.focus();
        await tick();

        expect(onLoss).not.toHaveBeenCalled();
        expect(window.__darwinFocusLoss).toHaveLength(0);
    });

    it('stays silent when the reader tabs out', async () => {
        field.focus();
        key(field, 'Tab');
        other.focus();
        await tick();

        expect(onLoss).not.toHaveBeenCalled();
    });

    it('stays silent when Enter saves and the page navigates away', async () => {
        field.focus();
        key(field, 'Enter');
        await tick();
        await tick();   // the POST is in flight
        wrapper.parentElement.removeChild(wrapper);
        await tick();

        expect(onLoss).not.toHaveBeenCalled();
    });

    it('a press that leaves focus in the field does not silence a later steal', async () => {
        field.focus();
        press(plain);   // focus stays in the field (jsdom does not move it)
        await tick();
        other.focus();
        await tick();

        expect(onLoss).toHaveBeenCalledTimes(1);
    });

    it('Escape that leaves focus in the field does not silence a later steal', async () => {
        field.focus();
        key(field, 'Escape');
        await tick();
        other.focus();
        await tick();

        expect(onLoss).toHaveBeenCalledTimes(1);
    });

    it('typing after Enter spends the Enter intent', async () => {
        field.focus();
        key(field, 'Enter');   // empty title: a no-op
        key(field, 'a');
        other.focus();
        await tick();

        expect(onLoss).toHaveBeenCalledTimes(1);
    });

    it('typing in the field is not reader intent to leave it', async () => {
        field.focus();
        key(field, 'a');
        other.focus();
        await tick();

        expect(onLoss).toHaveBeenCalledTimes(1);
    });

    it('treats a window blur (field still active) as no loss and keeps watching', async () => {
        field.focus();
        field.dispatchEvent(new FocusEvent('blur'));   // the window lost focus; activeElement unchanged
        await tick();
        expect(onLoss).not.toHaveBeenCalled();

        other.focus();   // a later steal in the same session is still caught
        await tick();
        expect(onLoss).toHaveBeenCalledTimes(1);
    });

    it('a window refocus resets the session evidence', async () => {
        field.focus();
        press(plain);   // intent recorded…
        field.dispatchEvent(new FocusEvent('focus'));   // …then the window comes back
        other.focus();
        await tick();

        expect(onLoss).toHaveBeenCalledTimes(1);
    });
});

describe('focusLossRecorder — recorded but not alerted (req #3632)', () => {
    it('a loss across a route change is recorded without the alert', async () => {
        field.focus();
        window.history.pushState(null, '', '/swarm/requirement/42');   // another field's save navigated
        wrapper.parentElement.removeChild(wrapper);
        await tick();

        expect(onLoss).not.toHaveBeenCalled();
        expect(window.__darwinFocusLoss[0]).toMatchObject({ cause: 'remounted', routeChanged: true, alerted: false });
    });

    it('an evidence-free blur after a touch focus (keyboard "Done") is recorded without the alert', async () => {
        press(field, 'pointerdown', { pointerType: 'touch' });
        field.focus();
        field.dispatchEvent(new FocusEvent('blur'));
        nativeBlur.call(field);
        await tick();

        expect(onLoss).not.toHaveBeenCalled();
        expect(window.__darwinFocusLoss[0]).toMatchObject({ cause: 'blurred', touch: true, alerted: false });
    });

    it('a touch session still alerts on a real steal', async () => {
        press(field, 'pointerdown', { pointerType: 'touch' });
        field.focus();
        other.focus();
        await tick();

        expect(onLoss).toHaveBeenCalledTimes(1);
    });
});

describe('focusLossRecorder — lifecycle (req #3632)', () => {
    it('restores the native focus/blur after a voluntary close', async () => {
        field.focus();
        expect(HTMLElement.prototype.focus).not.toBe(nativeFocus);
        press(other);
        other.focus();
        await tick();

        expect(HTMLElement.prototype.focus).toBe(nativeFocus);
        expect(HTMLElement.prototype.blur).toBe(nativeBlur);
    });

    it('restores the native focus/blur after an involuntary and an observer-driven close', async () => {
        field.focus();
        other.focus();
        await tick();
        expect(HTMLElement.prototype.focus).toBe(nativeFocus);

        field.focus();
        wrapper.parentElement.removeChild(wrapper);
        await tick();
        expect(HTMLElement.prototype.focus).toBe(nativeFocus);
        expect(HTMLElement.prototype.blur).toBe(nativeBlur);
    });

    it('a re-watch while the field is still mounted and focused is not a loss', async () => {
        field.focus();
        stop();
        stop = watchFocusLoss(field, { label: 'renamed', onLoss });
        await tick();
        expect(onLoss).not.toHaveBeenCalled();

        other.focus();   // the new watch picked the open focus straight back up
        await tick();
        expect(onLoss).toHaveBeenCalledTimes(1);
        expect(onLoss.mock.calls[0][0].label).toBe('renamed');
    });

    it('focus moving to another watched field hands the session over', async () => {
        const second = document.createElement('textarea');
        document.body.appendChild(second);
        const onSecondLoss = vi.fn();
        const stopSecond = watchFocusLoss(second, { label: 'second', onLoss: onSecondLoss });

        field.focus();
        press(second);
        second.focus();
        await tick();
        expect(onLoss).not.toHaveBeenCalled();

        other.focus();
        await tick();
        expect(onSecondLoss).toHaveBeenCalledTimes(1);
        stopSecond();
    });

    it('keeps only the newest 20 reports', async () => {
        for (let i = 0; i < 23; i++) {
            field.focus();
            other.focus();
            await tick();
        }
        expect(window.__darwinFocusLoss).toHaveLength(20);
    });
});
