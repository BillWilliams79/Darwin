import { describe, it, expect } from 'vitest';
import { selectSessionsForSwarmStart } from '../sessionFilter';

const mkSession = (id, started_at, extra = {}) => ({
    id, started_at, swarm_status: 'active', title: `s${id}`, branch: `feature/${id}`,
    ...extra,
});

describe('selectSessionsForSwarmStart (req #2494)', () => {
    it('returns [] when sessions is undefined', () => {
        expect(selectSessionsForSwarmStart(undefined, [], 1)).toEqual([]);
    });

    it('returns [] when junction is undefined', () => {
        expect(selectSessionsForSwarmStart([], undefined, 1)).toEqual([]);
    });

    it('returns [] when swarmStartId is missing', () => {
        const sessions = [mkSession(10, '2026-05-01T00:00:00')];
        const junction = [{ swarm_start_fk: 1, session_fk: 10 }];
        expect(selectSessionsForSwarmStart(sessions, junction, null)).toEqual([]);
        expect(selectSessionsForSwarmStart(sessions, junction, 0)).toEqual([]);
    });

    it('returns [] when no junction rows match the swarmStartId', () => {
        const sessions = [mkSession(10, '2026-05-01T00:00:00')];
        const junction = [{ swarm_start_fk: 99, session_fk: 10 }];
        expect(selectSessionsForSwarmStart(sessions, junction, 1)).toEqual([]);
    });

    it('returns only sessions whose ids appear in the junction with this swarm_start_fk', () => {
        const sessions = [
            mkSession(10, '2026-05-01T00:00:00'),
            mkSession(20, '2026-05-02T00:00:00'),
            mkSession(30, '2026-05-03T00:00:00'),
        ];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 2, session_fk: 20 }, // wrong swarm-start
            { swarm_start_fk: 1, session_fk: 30 },
        ];
        const result = selectSessionsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.id)).toEqual([30, 10]); // started_at desc
    });

    it('drops junction rows referencing sessions absent from the user list (cross-creator safety)', () => {
        const sessions = [mkSession(10, '2026-05-01T00:00:00')];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 1, session_fk: 9999 }, // belongs to another creator
        ];
        const result = selectSessionsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.id)).toEqual([10]);
    });

    it('sorts by started_at desc with id desc as tie-breaker', () => {
        const sessions = [
            mkSession(10, '2026-05-01T00:00:00'),
            mkSession(11, '2026-05-01T00:00:00'), // tie on time
            mkSession(20, '2026-05-02T00:00:00'),
        ];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 1, session_fk: 11 },
            { swarm_start_fk: 1, session_fk: 20 },
        ];
        const result = selectSessionsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.id)).toEqual([20, 11, 10]);
    });

    it('treats null started_at as oldest (sorts last)', () => {
        const sessions = [
            mkSession(10, null),
            mkSession(20, '2026-05-02T00:00:00'),
        ];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 1, session_fk: 20 },
        ];
        const result = selectSessionsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.id)).toEqual([20, 10]);
    });

    it('handles empty arrays without throwing', () => {
        expect(selectSessionsForSwarmStart([], [], 1)).toEqual([]);
    });
});
