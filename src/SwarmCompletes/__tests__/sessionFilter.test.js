import { describe, it, expect } from 'vitest';
import { selectSessionsForSwarmComplete } from '../sessionFilter';

const mkSession = (id, started_at, extra = {}) => ({
    id, started_at, swarm_status: 'completed', title: `s${id}`, branch: `feature/${id}`,
    ...extra,
});

describe('selectSessionsForSwarmComplete (req #2497)', () => {
    it('returns [] when sessions is undefined', () => {
        expect(selectSessionsForSwarmComplete(undefined, [], 1)).toEqual([]);
    });

    it('returns [] when junction is undefined', () => {
        expect(selectSessionsForSwarmComplete([], undefined, 1)).toEqual([]);
    });

    it('returns [] when swarmCompleteId is missing', () => {
        const sessions = [mkSession(10, '2026-05-01T00:00:00')];
        const junction = [{ swarm_complete_fk: 1, session_fk: 10 }];
        expect(selectSessionsForSwarmComplete(sessions, junction, null)).toEqual([]);
        expect(selectSessionsForSwarmComplete(sessions, junction, 0)).toEqual([]);
    });

    it('returns [] when no junction rows match the swarmCompleteId', () => {
        const sessions = [mkSession(10, '2026-05-01T00:00:00')];
        const junction = [{ swarm_complete_fk: 99, session_fk: 10 }];
        expect(selectSessionsForSwarmComplete(sessions, junction, 1)).toEqual([]);
    });

    it('returns only sessions whose ids appear in the junction with this swarm_complete_fk', () => {
        const sessions = [
            mkSession(10, '2026-05-01T00:00:00'),
            mkSession(20, '2026-05-02T00:00:00'),
            mkSession(30, '2026-05-03T00:00:00'),
        ];
        const junction = [
            { swarm_complete_fk: 1, session_fk: 10 },
            { swarm_complete_fk: 2, session_fk: 20 }, // wrong swarm-complete
            { swarm_complete_fk: 1, session_fk: 30 },
        ];
        const result = selectSessionsForSwarmComplete(sessions, junction, 1);
        expect(result.map(r => r.id)).toEqual([30, 10]); // started_at desc
    });

    it('drops junction rows referencing sessions absent from the user list (cross-creator safety)', () => {
        const sessions = [mkSession(10, '2026-05-01T00:00:00')];
        const junction = [
            { swarm_complete_fk: 1, session_fk: 10 },
            { swarm_complete_fk: 1, session_fk: 9999 }, // belongs to another creator
        ];
        const result = selectSessionsForSwarmComplete(sessions, junction, 1);
        expect(result.map(r => r.id)).toEqual([10]);
    });

    it('sorts by started_at desc with id desc as tie-breaker', () => {
        const sessions = [
            mkSession(10, '2026-05-01T00:00:00'),
            mkSession(11, '2026-05-01T00:00:00'), // tie on time
            mkSession(20, '2026-05-02T00:00:00'),
        ];
        const junction = [
            { swarm_complete_fk: 1, session_fk: 10 },
            { swarm_complete_fk: 1, session_fk: 11 },
            { swarm_complete_fk: 1, session_fk: 20 },
        ];
        const result = selectSessionsForSwarmComplete(sessions, junction, 1);
        expect(result.map(r => r.id)).toEqual([20, 11, 10]);
    });

    it('treats null started_at as oldest (sorts last)', () => {
        const sessions = [
            mkSession(10, null),
            mkSession(20, '2026-05-02T00:00:00'),
        ];
        const junction = [
            { swarm_complete_fk: 1, session_fk: 10 },
            { swarm_complete_fk: 1, session_fk: 20 },
        ];
        const result = selectSessionsForSwarmComplete(sessions, junction, 1);
        expect(result.map(r => r.id)).toEqual([20, 10]);
    });

    it('handles empty arrays without throwing', () => {
        expect(selectSessionsForSwarmComplete([], [], 1)).toEqual([]);
    });
});
