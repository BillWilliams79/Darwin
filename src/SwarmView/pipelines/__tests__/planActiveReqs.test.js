// Req #3721 — which of a plan's requirements the Active box lists.

import { describe, it, expect } from 'vitest';
import { activePlanRequirements, isActiveRequirement, ACTIVE_SESSION_STATUSES } from '../planActiveReqs';

const req = (id, session_status, extra = {}) => ({
    id, title: `R${id}`, requirement_status: 'development', session_status, machine_fk: null, ...extra,
});

describe('activePlanRequirements (req #3721)', () => {
    it('lists starting through completing, never paused, completed or no session', () => {
        expect(ACTIVE_SESSION_STATUSES).toEqual(
            ['starting', 'waiting', 'planning', 'active', 'review', 'completing']);
        const requirements = [
            req(1, 'starting'), req(2, 'waiting'), req(3, 'planning'), req(4, 'active'),
            req(5, 'review'), req(6, 'completing'), req(7, 'paused'), req(8, 'completed'),
            req(9, 'no_session'), req(10, undefined), req(11, 'mystery'),
        ];
        const rows = [{ reqIds: requirements.map(r => r.id) }];
        expect(activePlanRequirements({ rows, requirements }).map(r => r.id))
            .toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('drops a deferred or wontfix requirement whatever its session says', () => {
        expect(isActiveRequirement(req(1, 'active', { requirement_status: 'deferred' }))).toBe(false);
        expect(isActiveRequirement(req(1, 'review', { requirement_status: 'wontfix' }))).toBe(false);
        expect(isActiveRequirement(req(1, 'completing', { requirement_status: 'met' }))).toBe(true);
    });

    it('keeps the cards’ order, lists a twice-seated requirement once, and honours the machine filter', () => {
        const requirements = [req(30, 'active'), req(10, 'review'), req(20, 'active', { machine_fk: 2 })];
        const rows = [{ reqIds: [30, 10] }, { reqIds: [10, 20] }];
        const items = activePlanRequirements({ rows, requirements });
        expect(items.map(r => r.id)).toEqual([30, 10, 20]);
        expect(items[1]).toEqual({ id: 10, title: 'R10', sessionStatus: 'review',
            status: 'development', machineFk: null });
        expect(activePlanRequirements({ rows, requirements, hiddenMachines: new Set([2]) })
            .map(r => r.id)).toEqual([30, 10]);
    });

    it('is empty, not a throw, with nothing in hand', () => {
        expect(activePlanRequirements()).toEqual([]);
        expect(activePlanRequirements({ rows: [{ reqIds: [1] }], requirements: [] })).toEqual([]);
    });
});
