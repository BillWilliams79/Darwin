// req #3622 — which requirements the Urgent Review box lists, and how wide it is.

import { describe, it, expect } from 'vitest';

import {
    URGENT_SESSION_STATUSES, urgentReviewRequirements, urgentBoxWidthPx,
} from '../pipelineUrgentReview';
import { buildSessionStatusIndex } from '../pipelineViewModel';
import { CARD_FONT, cardGeometryFor, STEP_WIDTH_SCALES } from '../pipelinePlanLayout';

const reqs = [
    { id: 30, title: 'Thirty' }, { id: 10, title: 'Ten' },
    { id: 20, title: 'Twenty' }, { id: 40, title: 'Forty' },
];

describe('urgentReviewRequirements', () => {
    it('waiting and review are the statuses that stop on the user', () => {
        expect(URGENT_SESSION_STATUSES).toEqual(['waiting', 'review']);
    });

    it('lists only requirements whose latest session is waiting or review, by id', () => {
        const idx = new Map([[30, 'review'], [10, 'waiting'], [20, 'active'],
            [40, 'paused']]);
        expect(urgentReviewRequirements(idx, reqs)).toEqual([
            { id: 10, title: 'Ten', sessionStatus: 'waiting' },
            { id: 30, title: 'Thirty', sessionStatus: 'review' },
        ]);
    });

    it('reads the LATEST session: a relaunched requirement is not stuck on an old review', () => {
        const idx = buildSessionStatusIndex({
            requirementSessions: [
                { requirement_fk: 10, session_fk: 1 }, { requirement_fk: 10, session_fk: 5 },
                { requirement_fk: 20, session_fk: 2 }, { requirement_fk: 20, session_fk: 6 },
            ],
            sessions: [
                { id: 1, swarm_status: 'review' }, { id: 5, swarm_status: 'active' },
                { id: 2, swarm_status: 'completed' }, { id: 6, swarm_status: 'review' },
            ],
        });
        expect(urgentReviewRequirements(idx, reqs).map((r) => r.id)).toEqual([20]);
    });

    it('still lists a requirement the title read does not carry', () => {
        expect(urgentReviewRequirements(new Map([[99, 'review']]), reqs))
            .toEqual([{ id: 99, title: '', sessionStatus: 'review' }]);
    });

    it('is empty, not an answer, while the session index is unknown', () => {
        expect(urgentReviewRequirements(null, reqs)).toEqual([]);
        expect(urgentReviewRequirements(undefined, undefined)).toEqual([]);
    });
});

describe('urgentBoxWidthPx', () => {
    it('is one step card frame through the zoom, at every Step Width rung', () => {
        STEP_WIDTH_SCALES.forEach((scale, i) => {
            for (const k of [0.2, 0.6, 1, 3]) {
                expect(urgentBoxWidthPx(i + 1, k))
                    .toBeCloseTo(cardGeometryFor(scale).cardFrameW * k, 10);
            }
        });
    });

    it('defaults to the base rung at 1x, and an out-of-range rung or bad zoom reads as those', () => {
        const base = cardGeometryFor(1).cardFrameW;
        expect(urgentBoxWidthPx()).toBeCloseTo(base, 10);
        expect(urgentBoxWidthPx(9, 1)).toBeCloseTo(base, 10);
        expect(urgentBoxWidthPx(1, 0)).toBeCloseTo(base, 10);
        expect(urgentBoxWidthPx(1, NaN)).toBeCloseTo(base, 10);
    });

    // User review: "narrow like pencil" — the overview zoom put a 9px-type
    // box ~80px wide. The floor is a step card at the box's own type size.
    it('is never narrower than a step card at the box\'s own type size', () => {
        STEP_WIDTH_SCALES.forEach((scale, i) => {
            const frameW = cardGeometryFor(scale).cardFrameW;
            const floor = frameW * (9 / CARD_FONT.req);
            // Overview zoom: the card is a sliver, the box is the floor.
            expect(urgentBoxWidthPx(i + 1, 0.2, 9)).toBeCloseTo(floor, 10);
            expect(urgentBoxWidthPx(i + 1, 0.2, 9)).toBeGreaterThan(frameW * 0.2);
            // Zoomed in past the floor: exactly the card on screen.
            expect(urgentBoxWidthPx(i + 1, 3, 16)).toBeCloseTo(frameW * 3, 10);
        });
        // At the overview a 9px row holds what a step card's line holds.
        expect(urgentBoxWidthPx(1, 0.2, 9) / 9)
            .toBeCloseTo(cardGeometryFor(1).cardFrameW / CARD_FONT.req, 10);
    });

    it('grows with the Step Width control', () => {
        expect(urgentBoxWidthPx(4, 1)).toBeGreaterThan(urgentBoxWidthPx(1, 1));
    });
});
