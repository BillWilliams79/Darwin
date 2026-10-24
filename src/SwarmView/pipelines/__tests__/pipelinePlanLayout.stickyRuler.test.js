// req #3873 — the time ruler's left edge always names a day: the slot under
// the strip's left edge is pinned there and the next drawn date pushes it off,
// the initiative chips' sticky-header move turned on its side.

import { describe, it, expect } from 'vitest';
import {
    stickyRulerLabel, drawnRulerLabelKeys, computeRuler,
    RULER_LABEL_GAP, RULER_PIN_PAD,
} from '../pipelinePlanLayout';

// Three days and the future, 200 world px apart, every label drawn.
const slots = [
    { key: 'd1', kind: 'dated', label: "Oct 21 '26", labelX: 10, labelW: 80 },
    { key: 'd2', kind: 'dated', label: 'Oct 22', labelX: 210, labelW: 48 },
    { key: 'd3', kind: 'dated', label: 'Oct 23', labelX: 410, labelW: 48 },
    { key: 'fut', kind: 'future', label: 'future', labelX: 610, labelW: 48 },
].map((s) => ({ ...s, showLabel: true }));
const drawn = drawnRulerLabelKeys(slots, 1);
const at = (panX, k = 1) => stickyRulerLabel(slots, drawn, { x: -panX * k, y: 0, k }, 1);

describe('stickyRulerLabel (req #3873)', () => {
    it('pins nothing while the first date is itself on screen', () => {
        expect(at(-50)).toBeNull();
        expect(at(0)).toBeNull();
    });

    it('pins the day under the left edge flush to it, and hides its own copy', () => {
        const p = at(300);   // left edge at world 300: inside Oct 22
        expect(p.key).toBe('d2');
        expect(p.text).toBe('Oct 22');
        expect(p.x).toBe(300 + RULER_PIN_PAD);
        expect([...p.hide]).toEqual(['d2']);
    });

    it('is pushed off by the next drawn date, never overlapping it', () => {
        // Oct 23 starts at 410; the pinned Oct 22 (48 wide) must end a gap before it.
        const p = at(380);
        expect(p.key).toBe('d2');
        expect(p.x).toBe(410 - RULER_LABEL_GAP - 48);
        expect(p.x).toBeLessThan(380 + RULER_PIN_PAD);
        expect(p.x + 48 + RULER_LABEL_GAP).toBeLessThanOrEqual(410);
    });

    it('hands off to the next date with no jump as it reaches the edge', () => {
        const edge = 410 - RULER_PIN_PAD;           // Oct 23's natural start == the pin
        const p = at(edge);
        expect(p.key).toBe('d3');
        expect(p.x).toBe(410);
    });

    it('pins the future too', () => {
        const p = at(900);
        expect(p.key).toBe('fut');
        expect(p.kind).toBe('future');
        expect(p.x).toBe(900 + RULER_PIN_PAD);
    });

    it('works in screen px at any zoom', () => {
        const k = 0.25;
        const mag = 1 / k;
        const d = drawnRulerLabelKeys(slots, mag);
        // Past the last date nothing pushes: the pad is 4 SCREEN px, 16 world px.
        const p = stickyRulerLabel(slots, d, { x: -900 * k, y: 0, k }, mag);
        expect(p.key).toBe('fut');
        expect(p.x).toBe(900 + RULER_PIN_PAD / k);
        // Inside Oct 22, which the 4x-wide type thinned and which has no room
        // before Oct 23: Oct 21 keeps the pin, pushed by Oct 23.
        expect(d.has('d2')).toBe(false);
        const q = stickyRulerLabel(slots, d, { x: -300 * k, y: 0, k }, mag);
        expect(q.key).toBe('d1');
        expect(q.x).toBe(410 - RULER_LABEL_GAP * mag - 80 * mag);
    });

    it('pins a day whose own label was thinned away', () => {
        const thin = slots.map((s) => (s.key === 'd2' ? { ...s, showLabel: false } : s));
        const d = drawnRulerLabelKeys(thin, 1);
        expect(d.has('d2')).toBe(false);
        expect(stickyRulerLabel(thin, d, { x: -300, y: 0, k: 1 }, 1).key).toBe('d2');
    });

    it('a thinned day with no room keeps the pin on the day before, pushed', () => {
        // Oct 22 thinned; at a left edge of 360 it would sit at 364 and end
        // 2px past Oct 23's start (410) — so Oct 21 keeps the pin, pushed by Oct 23.
        const thin = slots.map((s) => (s.key === 'd2' ? { ...s, showLabel: false } : s));
        const d = drawnRulerLabelKeys(thin, 1);
        const p = stickyRulerLabel(thin, d, { x: -360, y: 0, k: 1 }, 1);
        expect(p.key).toBe('d1');
        expect(p.x).toBe(410 - RULER_LABEL_GAP - 80);
    });

    it('hides an earlier date it would land on', () => {
        // d1 is 300 wide, so at a left edge of 205 its text still reaches under the pin.
        const wide = slots.map((s) => (s.key === 'd1' ? { ...s, labelW: 300 } : s));
        const p = stickyRulerLabel(wide, new Set(['d1', 'd3', 'fut']),
            { x: -206, y: 0, k: 1 }, 1);
        expect(p.key).toBe('d2');
        expect(p.hide.has('d1')).toBe(true);
    });

    it('starts clear of the maximized page\'s switch', () => {
        const startRight = 340;
        const d = drawnRulerLabelKeys(slots, 1, startRight);
        const p = stickyRulerLabel(slots, d, { x: 0, y: 0, k: 1 }, 1, startRight);
        expect(p.key).toBe('d2');
        expect(p.x).toBe(startRight + RULER_LABEL_GAP);
    });

    it('is null on a degenerate transform or an empty ruler', () => {
        expect(stickyRulerLabel(slots, drawn, null, 1)).toBeNull();
        expect(stickyRulerLabel(slots, drawn, { x: 0, k: 0 }, 1)).toBeNull();
        expect(stickyRulerLabel([], drawn, { x: -300, k: 1 }, 1)).toBeNull();
    });

    it('reads computeRuler output directly', () => {
        const R = computeRuler([
            { key: 'a', kind: 'dated', day: '2026-10-22', origin: 0 },
            { key: 'b', kind: 'dated', day: '2026-10-23', origin: 1 },
        ], [100, 300], [200, 200], 600);
        const p = stickyRulerLabel(R.slots, drawnRulerLabelKeys(R.slots, 1),
            { x: -150, y: 0, k: 1 }, 1);
        expect(p.key).toBe('a');
        expect(p.text).toBe("Oct 22 '26");
    });
});
