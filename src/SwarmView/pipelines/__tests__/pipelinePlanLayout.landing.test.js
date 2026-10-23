// Req #3637 — "the pipelines viewport should be pretty damn sticky. refresh,
// reload, should not change the viewport". The canvas half of that contract:
// what the plan canvas does with its camera each time its landing effect runs.

import { describe, it, expect } from 'vitest';
import { planLandingAction } from '../pipelinePlanLayout';

const SAVED = { x: -420, y: -130, k: 0.62 };
const at = (plan, rung = 1) => ({ landKey: `p${plan}|sw${rung}`, planKey: `p${plan}` });

describe('planLandingAction (req #3637)', () => {
    it('restores the saved camera on arrival — every reload, Back and toggle is a mount', () => {
        expect(planLandingAction(null, at(7), SAVED)).toBe('restore');
    });

    it('lands on the base view on a first-ever visit', () => {
        expect(planLandingAction(null, at(7), null)).toBe('reset');
    });

    it('never re-lands on a resize or a refetch that grew the plan', () => {
        expect(planLandingAction(at(7), at(7), SAVED)).toBe('keep');
        expect(planLandingAction(at(7), at(7), null)).toBe('keep');
    });

    it('an Epic Width change is an explicit rescale: base view, not a stale camera', () => {
        expect(planLandingAction(at(7, 1), at(7, 2), SAVED)).toBe('reset');
    });

    it('an in-place switch to another plan restores THAT plan\'s camera', () => {
        expect(planLandingAction(at(7), at(9), SAVED)).toBe('restore');
        expect(planLandingAction(at(7), at(9), null)).toBe('reset');
    });
});
