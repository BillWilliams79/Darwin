// req #3244 — the frontend's requirement_status timestamp derivation must match
// darwin-mcp/services/requirements.py::update_requirement exactly:
//   development -> started_at, met/wontfix -> completed_at, deferred -> deferred_at,
//   every other status -> all three cleared.
import { describe, it, expect } from 'vitest';
import { requirementStatusTimestampFields, requirementStatusTimestampState } from '../requirementStatusTimestamps';

const NOW = '2026-08-02T12:00:00.000Z';

describe('requirementStatusTimestampFields (PUT body form)', () => {
    it('stamps started_at and clears the other two for development', () => {
        expect(requirementStatusTimestampFields('development', NOW)).toEqual({
            started_at: NOW, completed_at: 'NULL', deferred_at: 'NULL',
        });
    });

    it('stamps completed_at and clears the other two for met', () => {
        expect(requirementStatusTimestampFields('met', NOW)).toEqual({
            started_at: 'NULL', completed_at: NOW, deferred_at: 'NULL',
        });
    });

    it('stamps completed_at for wontfix — terminal like met (req #2783)', () => {
        expect(requirementStatusTimestampFields('wontfix', NOW)).toEqual({
            started_at: 'NULL', completed_at: NOW, deferred_at: 'NULL',
        });
    });

    it('stamps deferred_at and clears the other two for deferred', () => {
        expect(requirementStatusTimestampFields('deferred', NOW)).toEqual({
            started_at: 'NULL', completed_at: 'NULL', deferred_at: NOW,
        });
    });

    for (const status of ['authoring', 'approved', 'swarm_ready']) {
        it(`clears all three for '${status}'`, () => {
            expect(requirementStatusTimestampFields(status, NOW)).toEqual({
                started_at: 'NULL', completed_at: 'NULL', deferred_at: 'NULL',
            });
        });
    }
});

describe('requirementStatusTimestampState (local-state form)', () => {
    it('uses real null instead of the NULL sentinel', () => {
        expect(requirementStatusTimestampState('met', NOW)).toEqual({
            started_at: null, completed_at: NOW, deferred_at: null,
        });
        expect(requirementStatusTimestampState('authoring', NOW)).toEqual({
            started_at: null, completed_at: null, deferred_at: null,
        });
    });
});
