import { describe, it, expect } from 'vitest';
import {
    FRAME_STRATEGIES,
    frameView,
    DEFAULT_FRAME_STRATEGY,
    reflowPanDeltaY,
} from '../frameStrategies';

describe('DEFAULT_FRAME_STRATEGY', () => {
    it('is centerMain', () => {
        expect(DEFAULT_FRAME_STRATEGY).toBe('centerMain');
    });
});

describe('FRAME_STRATEGIES.centerMain', () => {
    it('places x at 0', () => {
        const result = FRAME_STRATEGIES.centerMain({ mainY: 200 }, { height: 600 });
        expect(result.x).toBe(0);
    });

    it('centers mainY in the viewport vertically', () => {
        const result = FRAME_STRATEGIES.centerMain({ mainY: 200 }, { height: 600 });
        // y = round(600/2 - 200) = round(100) = 100
        expect(result.y).toBe(100);
    });

    it('produces negative y when mainY exceeds half viewport', () => {
        const result = FRAME_STRATEGIES.centerMain({ mainY: 500 }, { height: 400 });
        // y = round(200 - 500) = -300
        expect(result.y).toBe(-300);
    });

    it('rounds y to nearest integer', () => {
        const result = FRAME_STRATEGIES.centerMain({ mainY: 101 }, { height: 600 });
        // y = round(300 - 101) = round(199) = 199
        expect(result.y).toBe(199);
    });

    it('handles mainY = 0', () => {
        const result = FRAME_STRATEGIES.centerMain({ mainY: 0 }, { height: 800 });
        expect(result.y).toBe(400);
    });

    it('handles null layout gracefully (mainY defaults to 0)', () => {
        const result = FRAME_STRATEGIES.centerMain(null, { height: 600 });
        expect(result.y).toBe(300);
    });

    it('handles layout without mainY (defaults to 0)', () => {
        const result = FRAME_STRATEGIES.centerMain({}, { height: 600 });
        expect(result.y).toBe(300);
    });
});

describe('frameView', () => {
    it('uses centerMain by default', () => {
        const result = frameView({ mainY: 200 }, { height: 600 });
        expect(result).toEqual({ x: 0, y: 100 });
    });

    it('accepts an explicit strategy name', () => {
        const result = frameView({ mainY: 200 }, { height: 600 }, 'centerMain');
        expect(result).toEqual({ x: 0, y: 100 });
    });

    it('falls back to centerMain for unknown strategy', () => {
        const result = frameView({ mainY: 200 }, { height: 600 }, 'nonexistent');
        expect(result).toEqual({ x: 0, y: 100 });
    });
});

describe('reflowPanDeltaY (req #2754)', () => {
    it('compensates a same-project reflow by the mainY change (add branch/build grows mainY → negative delta)', () => {
        // Adding hotfix/bootleg branches grows the strata above the trunk, so
        // mainY increases; the pan must shift UP (negative) to keep the trunk fixed.
        const delta = reflowPanDeltaY({
            sameProject: true,
            framed: true,
            prevMainY: 200,
            mainY: 260,
        });
        expect(delta).toBe(-60);
    });

    it('compensates a collapse (filter toggle shrinks mainY → positive delta)', () => {
        const delta = reflowPanDeltaY({
            sameProject: true,
            framed: true,
            prevMainY: 260,
            mainY: 200,
        });
        expect(delta).toBe(60);
    });

    it('returns 0 on a project switch (let runFrame reframe)', () => {
        const delta = reflowPanDeltaY({
            sameProject: false,
            framed: true,
            prevMainY: 200,
            mainY: 500,
        });
        expect(delta).toBe(0);
    });

    it('returns 0 before the project is framed', () => {
        const delta = reflowPanDeltaY({
            sameProject: true,
            framed: false,
            prevMainY: 200,
            mainY: 260,
        });
        expect(delta).toBe(0);
    });

    it('returns 0 when prevMainY is null (first measurable layout)', () => {
        const delta = reflowPanDeltaY({
            sameProject: true,
            framed: true,
            prevMainY: null,
            mainY: 260,
        });
        expect(delta).toBe(0);
    });

    it('returns 0 when mainY is null (transient empty layout)', () => {
        const delta = reflowPanDeltaY({
            sameProject: true,
            framed: true,
            prevMainY: 200,
            mainY: null,
        });
        expect(delta).toBe(0);
    });

    it('returns 0 when mainY is unchanged (no jump, no-op)', () => {
        const delta = reflowPanDeltaY({
            sameProject: true,
            framed: true,
            prevMainY: 200,
            mainY: 200,
        });
        expect(delta).toBe(0);
    });

    it('treats mainY = 0 as a real value, not missing', () => {
        const delta = reflowPanDeltaY({
            sameProject: true,
            framed: true,
            prevMainY: 40,
            mainY: 0,
        });
        expect(delta).toBe(40);
    });
});
