// @vitest-environment jsdom
// req #3662 — the press timeline's sensor rules.

import { describe, it, expect, vi } from 'vitest';
import {
    isEditingField, isOwnPress, releaseLiftFocus, isLiftBlur, DarwinTouchSensor, DarwinPointerSensor,
    captureLiftFocus, restoreLiftFocus,
    TOUCH_SENSOR_OPTIONS, POINTER_SENSOR_OPTIONS, KEYBOARD_CODES,
} from '../sensors';
import * as timeline from '../pressTimeline';
import * as planPress from '../../SwarmView/pipelines/planPressGesture';
import { REQ_DRAG_SLOP } from '../../SwarmView/pipelines/pipelineReqDrag';

describe('one press timeline', () => {
    it('the sensors read their numbers from pressTimeline', () => {
        expect(TOUCH_SENSOR_OPTIONS.activationConstraint).toEqual({
            delay: timeline.LIFT_DELAY_MS, tolerance: timeline.TOUCH_TOLERANCE_PX,
        });
        // A move OR a long click lifts the mouse's item.
        expect(POINTER_SENSOR_OPTIONS.activationConstraint).toEqual({
            distance: timeline.MOUSE_ACTIVATION_PX, delay: timeline.LIFT_DELAY_MS, tolerance: Infinity,
        });
        expect(KEYBOARD_CODES.start).toEqual(['Space']);
        expect(KEYBOARD_CODES.cancel).toEqual(['Escape']);
    });

    it('the plan canvas press gesture uses the same numbers', () => {
        expect(planPress.LONG_PRESS_MS).toBe(timeline.LONG_PRESS_MS);
        expect(planPress.PRESS_SLOP_PX).toBe(timeline.PRESS_SLOP_PX);
        expect(planPress.DOUBLE_CLICK_MS).toBe(timeline.DOUBLE_CLICK_MS);
        // ...and its requirement drag (req #3665).
        expect(REQ_DRAG_SLOP).toBe(timeline.MOUSE_ACTIVATION_PX);
    });

    it('lift comes before the long press', () => {
        expect(timeline.LIFT_DELAY_MS).toBeLessThan(timeline.LONG_PRESS_MS);
    });
});

describe('isEditingField', () => {
    it('a press in a FOCUSED field is editing; an unfocused field lifts', () => {
        const row = document.createElement('div');
        const field = document.createElement('textarea');
        row.appendChild(field);
        document.body.appendChild(row);
        expect(isEditingField(field)).toBe(false);
        field.focus();
        expect(isEditingField(field)).toBe(true);
        expect(isEditingField(row)).toBe(false);
        row.remove();
    });
});

describe('isOwnPress', () => {
    it('a press that reached the item only through a React portal is not its own', () => {
        const item = document.createElement('div');
        const child = document.createElement('span');
        item.appendChild(child);
        const portal = document.createElement('div');
        expect(isOwnPress({ currentTarget: item, target: child })).toBe(true);
        expect(isOwnPress({ currentTarget: item, target: portal })).toBe(false);
    });
});

describe('releaseLiftFocus / isLiftBlur', () => {
    it('blurs the field the press focused, and marks THAT blur as not-an-edit', () => {
        const field = document.createElement('textarea');
        document.body.appendChild(field);
        const seen = [];
        field.addEventListener('blur', (e) => seen.push(isLiftBlur(e)));
        field.focus();
        releaseLiftFocus(field);
        expect(document.activeElement).not.toBe(field);
        field.focus();
        field.blur();
        expect(seen).toEqual([true, false]);
        field.remove();
    });

    it('a field already being edited inside the lifted item is blurred plainly, so it saves', () => {
        const item = document.createElement('div');
        const field = document.createElement('textarea');
        const grip = document.createElement('span');
        item.append(field, grip);
        document.body.appendChild(item);
        const seen = [];
        field.addEventListener('blur', (e) => seen.push(isLiftBlur(e)));
        field.focus();
        releaseLiftFocus(grip, item);
        expect(document.activeElement).not.toBe(field);
        expect(seen).toEqual([false]);
        item.remove();
    });

    it('leaves focus elsewhere alone', () => {
        const other = document.createElement('input');
        const pressed = document.createElement('div');
        document.body.append(other, pressed);
        other.focus();
        releaseLiftFocus(pressed);
        expect(document.activeElement).toBe(other);
        other.remove(); pressed.remove();
    });
});

describe('captureLiftFocus / restoreLiftFocus (req #3663 review)', () => {
    // <div data-testid=scope><div data-testid=item><div data-testid=row><textarea name=title>
    const build = (html) => {
        const host = document.createElement('div');
        host.innerHTML = html;
        document.body.appendChild(host);
        return host;
    };
    const press = (field) => ({ type: 'pointerdown', target: field });

    it('a press on a card\'s template row restores to THAT row, not the card\'s first title', () => {
        const host = build(`
            <div data-testid="category-card-5">
              <div data-testid="requirement-1"><textarea name="title">first</textarea></div>
              <div data-testid="requirement-template"><textarea name="title"></textarea></div>
            </div>`);
        const card = host.querySelector('[data-testid="category-card-5"]');
        const template = host.querySelector('[data-testid="requirement-template"] textarea');
        const spot = captureLiftFocus(press(template), card);
        restoreLiftFocus(spot);
        expect(document.activeElement).toBe(template);
        host.remove();
    });

    it('a row shown twice (its card and the aggregator) restores in the same kind of list it moved within', () => {
        const host = build(`
            <div data-testid="swarm-start-card">
              <div data-testid="requirement-9"><textarea name="title">agg copy</textarea></div>
            </div>
            <div data-testid="category-card-5">
              <div data-testid="requirement-9"><textarea name="title">card copy</textarea></div>
            </div>`);
        const lifted = host.querySelector('[data-testid="category-card-5"] [data-testid="requirement-9"]');
        const spot = captureLiftFocus(press(lifted.querySelector('textarea')), lifted);
        // Dropped into another category card: the old card no longer holds it.
        const other = document.createElement('div');
        other.setAttribute('data-testid', 'category-card-6');
        other.appendChild(lifted);
        host.appendChild(other);
        restoreLiftFocus(spot);
        expect(document.activeElement.value).toBe('card copy');
        host.remove();
    });
});

describe('DarwinPointerSensor', () => {
    it('starts ONCE when a move beats the long-click timer (no second start mid-drag)', () => {
        vi.useFakeTimers();
        const target = document.createElement('div');
        document.body.appendChild(target);
        const event = new Event('pointerdown');
        Object.defineProperty(event, 'target', { value: target });
        Object.assign(event, { clientX: 0, clientY: 0 });
        let starts = 0;
        const sensor = new DarwinPointerSensor({
            event, active: 'x', activeNode: { node: { current: target } },
            options: POINTER_SENSOR_OPTIONS, context: {},
            onStart: () => { starts++; }, onMove: () => {}, onEnd: () => {}, onAbort: () => {},
            onCancel: () => {}, onPending: () => {},
        });
        sensor.handleStart();            // the move got there first
        vi.advanceTimersByTime(2000);    // ...and the hold timer must not start it again
        expect(starts).toBe(1);
        sensor.detach();
        target.remove();
        vi.useRealTimers();
    });
});

describe('DarwinTouchSensor', () => {
    it('does not cancel a drag on window resize (the phone URL bar resizes mid-scroll)', () => {
        const target = document.createElement('div');
        document.body.appendChild(target);
        const event = new Event('touchstart');
        Object.defineProperty(event, 'target', { value: target });
        Object.defineProperty(event, 'touches', { value: [{ clientX: 1, clientY: 1 }] });
        let cancelled = false;
        const sensor = new DarwinTouchSensor({
            event, active: 'x', activeNode: { node: { current: target } },
            options: TOUCH_SENSOR_OPTIONS, context: {},
            onStart: () => {}, onMove: () => {}, onEnd: () => {}, onAbort: () => {},
            onCancel: () => { cancelled = true; }, onPending: () => {},
        });
        window.dispatchEvent(new Event('resize'));
        expect(cancelled).toBe(false);
        expect(sensor.windowListeners.listeners.some(([name]) => name === 'resize')).toBe(false);
        sensor.detach();
        target.remove();
    });
});
