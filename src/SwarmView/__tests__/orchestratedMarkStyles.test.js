// req #3419 — what a marked title box looks like.
//
// `orchestratedMarkSx` is pure precisely so this file can pin the rule without
// mounting anything. The component-level proof that the MARK tracks the same set
// as the FILTER lives in `src/__tests__/requirementVisibility.harness.test.jsx`;
// this file is about appearance once that question is answered.
//
// THE MARK IS A GOLD BACKGROUND (user direction, 2026-08-10), plus a gold FOCUS
// RING at the theme's own focus width — the theme's blue ring was tried first
// and was overshadowed by the gold field, reading as no focus indicator at all.
// An earlier cut carried two gear-menu toggles and a four-rung border-size
// ladder; all of it was removed along with the store and the `SettingsMenu`
// prop that hosted it. These tests are written against the ABSENCE of an
// outline at rest and on hover, so a border creeping back into either state
// fails here rather than only on screen.

import { describe, it, expect } from 'vitest';
import {
    orchestratedMarkSx,
    ORCHESTRATED_GOLD,
    ORCHESTRATED_GOLD_FILL,
    FOCUS_BORDER_WIDTH,
} from '../orchestratedMarkStyles';

const inner = (sx) => sx['& .MuiOutlinedInput-root'];

describe('orchestratedMarkSx', () => {
    it('marks nothing on a requirement no plan carries', () => {
        // The load-bearing case: an unmarked row must render EXACTLY as it did
        // before this feature existed, which an empty object guarantees.
        expect(orchestratedMarkSx({ isOrchestrated: false })).toEqual({});
        expect(orchestratedMarkSx({})).toEqual({});
        expect(orchestratedMarkSx()).toEqual({});
    });

    it('is a gold background on a rounded rectangle', () => {
        const sx = orchestratedMarkSx({ isOrchestrated: true });
        expect(inner(sx).backgroundColor).toBe(ORCHESTRATED_GOLD_FILL);
        expect(inner(sx).borderRadius).toBe('8px');
    });

    it('draws NO outline at rest and NO outline on hover', () => {
        // The whole shape of the final design. A width of 0 rather than a
        // colour change, so nothing is drawn at all — a transparent border
        // would still occupy its box and shift the text.
        const sx = orchestratedMarkSx({ isOrchestrated: true });
        expect(inner(sx)['& .MuiOutlinedInput-notchedOutline']).toEqual({ borderWidth: 0 });
        expect(inner(sx)['&:hover .MuiOutlinedInput-notchedOutline']).toEqual({ borderWidth: 0 });
    });

    it('sets a border colour ONLY on focus', () => {
        // Guards the regression the removed border would creep back through:
        // rest and hover must carry no colour at all, so the gold cannot
        // reappear one interaction state at a time.
        const sx = orchestratedMarkSx({ isOrchestrated: true });
        expect(inner(sx)['& .MuiOutlinedInput-notchedOutline'].borderColor).toBeUndefined();
        expect(inner(sx)['&:hover .MuiOutlinedInput-notchedOutline'].borderColor).toBeUndefined();
    });

    it('draws a GOLD focus ring at the theme\'s own focus width', () => {
        // Leaving focus to the theme did not work: its ring is `primary.main`,
        // and blue on the gold field is overshadowed by it — on screen the
        // field read as having no focus indicator at all. Gold, and the SAME
        // width an unmarked field focuses at, so only the hue differs.
        const sx = orchestratedMarkSx({ isOrchestrated: true });
        expect(inner(sx)['&.Mui-focused .MuiOutlinedInput-notchedOutline']).toEqual({
            borderWidth: FOCUS_BORDER_WIDTH,
            borderColor: ORCHESTRATED_GOLD,
        });
    });

    it('focuses at the same weight as an unmarked field — 2px, MUI\'s default', () => {
        // The value is stated in this module rather than read from the theme,
        // so pin it: a marked field focusing at a different weight than a plain
        // one is the drift this asserts against.
        expect(FOCUS_BORDER_WIDTH).toBe('2px');
    });

    it('touches only the input root — no width, height or spacing', () => {
        // A marked row must line up with an unmarked one in the same card, so
        // the mark may not change the box model. `borderRadius` and
        // `backgroundColor` are paint; a stray margin/padding would not be.
        const sx = orchestratedMarkSx({ isOrchestrated: true });
        expect(Object.keys(sx)).toEqual(['& .MuiOutlinedInput-root']);
        for (const key of ['margin', 'padding', 'width', 'height', 'fontSize']) {
            expect(inner(sx)[key]).toBeUndefined();
        }
    });

    it('tints rather than fills — the title stays editable text', () => {
        // A solid gold would black out in dark mode. Assert the alpha is real
        // and below half, the property that keeps the theme's text readable on
        // top of it. With the border gone this value is the ENTIRE mark.
        const alpha = Number(ORCHESTRATED_GOLD_FILL.match(/,\s*([\d.]+)\)$/)[1]);
        expect(alpha).toBeGreaterThan(0);
        expect(alpha).toBeLessThan(0.5);
    });

    it('builds the fill from the named gold, not a second hex', () => {
        // One hue, one definition. `rgba(184,134,11,…)` IS `#B8860B`.
        const [r, g, b] = ORCHESTRATED_GOLD_FILL.match(/\d+/g).map(Number);
        const hex = `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`;
        expect(hex.toUpperCase()).toBe(ORCHESTRATED_GOLD.toUpperCase());
    });
});
