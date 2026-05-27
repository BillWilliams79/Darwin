import { describe, it, expect } from 'vitest';
import { selectRequirementsForSwarmStart } from '../requirementsList';

const mkSession = (id, sourceRef, startedAt, title) => ({
    id,
    source_ref: sourceRef,
    started_at: startedAt,
    title: title || `Title ${id}`,
});

describe('selectRequirementsForSwarmStart (req #2685)', () => {
    it('returns [] when sessions is undefined', () => {
        expect(selectRequirementsForSwarmStart(undefined, [], 1)).toEqual([]);
    });

    it('returns [] when junction is undefined', () => {
        expect(selectRequirementsForSwarmStart([], undefined, 1)).toEqual([]);
    });

    it('returns [] when swarmStartId is missing', () => {
        const sessions = [mkSession(10, 'requirement:42', '2026-05-01T00:00:00', 't')];
        const junction = [{ swarm_start_fk: 1, session_fk: 10 }];
        expect(selectRequirementsForSwarmStart(sessions, junction, null)).toEqual([]);
        expect(selectRequirementsForSwarmStart(sessions, junction, 0)).toEqual([]);
    });

    it('returns [] when no junction rows match the swarmStartId', () => {
        const sessions = [mkSession(10, 'requirement:42', '2026-05-01T00:00:00', 't')];
        const junction = [{ swarm_start_fk: 99, session_fk: 10 }];
        expect(selectRequirementsForSwarmStart(sessions, junction, 1)).toEqual([]);
    });

    it('returns the linked sessions with parsed reqId, title, sessionId', () => {
        const sessions = [
            mkSession(10, 'requirement:2685', '2026-05-01T00:00:00', 'swarm-start display'),
        ];
        const junction = [{ swarm_start_fk: 1, session_fk: 10 }];
        expect(selectRequirementsForSwarmStart(sessions, junction, 1)).toEqual([
            {
                reqId: '2685',
                title: 'swarm-start display',
                sessionId: 10,
                startedAt: '2026-05-01T00:00:00',
            },
        ]);
    });

    it('stacks multiple sessions in started_at ASC order (oldest first)', () => {
        const sessions = [
            mkSession(30, 'requirement:2687', '2026-05-03T00:00:00', 'default to Auto'),
            mkSession(10, 'requirement:2685', '2026-05-01T00:00:00', 'display'),
            mkSession(20, 'requirement:2686', '2026-05-02T00:00:00', 'stats'),
        ];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 1, session_fk: 20 },
            { swarm_start_fk: 1, session_fk: 30 },
        ];
        const result = selectRequirementsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.sessionId)).toEqual([10, 20, 30]);
        expect(result.map(r => r.reqId)).toEqual(['2685', '2686', '2687']);
    });

    it('uses id ASC as tie-breaker when started_at matches', () => {
        const sessions = [
            mkSession(20, 'requirement:200', '2026-05-01T00:00:00', 'b'),
            mkSession(10, 'requirement:100', '2026-05-01T00:00:00', 'a'),
            mkSession(11, 'requirement:101', '2026-05-01T00:00:00', 'c'),
        ];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 1, session_fk: 11 },
            { swarm_start_fk: 1, session_fk: 20 },
        ];
        const result = selectRequirementsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.sessionId)).toEqual([10, 11, 20]);
    });

    it('falls back to reqId=null when source_ref is missing or unparseable', () => {
        const sessions = [
            mkSession(10, null, '2026-05-01T00:00:00', 'direct session'),
            mkSession(20, 'issue:42', '2026-05-02T00:00:00', 'legacy issue'),
            mkSession(30, 'requirement:abc', '2026-05-03T00:00:00', 'malformed'),
        ];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 1, session_fk: 20 },
            { swarm_start_fk: 1, session_fk: 30 },
        ];
        const result = selectRequirementsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.reqId)).toEqual([null, null, null]);
        expect(result.map(r => r.title)).toEqual(['direct session', 'legacy issue', 'malformed']);
    });

    it('drops junction rows referencing sessions absent from the user list', () => {
        const sessions = [mkSession(10, 'requirement:10', '2026-05-01T00:00:00', 't')];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 1, session_fk: 9999 }, // unknown session
        ];
        const result = selectRequirementsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.sessionId)).toEqual([10]);
    });

    it('sorts null started_at LAST so real data renders first', () => {
        const sessions = [
            mkSession(10, 'requirement:10', null, 'null-time'),
            mkSession(20, 'requirement:20', '2026-05-02T00:00:00', 'b'),
        ];
        const junction = [
            { swarm_start_fk: 1, session_fk: 10 },
            { swarm_start_fk: 1, session_fk: 20 },
        ];
        const result = selectRequirementsForSwarmStart(sessions, junction, 1);
        expect(result.map(r => r.sessionId)).toEqual([20, 10]);
    });

    it('handles empty arrays without throwing', () => {
        expect(selectRequirementsForSwarmStart([], [], 1)).toEqual([]);
    });

    it('uses empty string title when session.title is null/undefined', () => {
        const sessions = [{ id: 10, source_ref: 'requirement:1', started_at: '2026-05-01T00:00:00' }];
        const junction = [{ swarm_start_fk: 1, session_fk: 10 }];
        const result = selectRequirementsForSwarmStart(sessions, junction, 1);
        expect(result[0].title).toBe('');
    });
});
