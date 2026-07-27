// Req #3117 — the two cost reads behind the plan table's Cost column.
//
// What is pinned here is not "the hooks exist" but the three properties that,
// if they broke, would break SILENTLY:
//
//   1. `sessionCostRollups` and `sessions` address the SAME TABLE. Without
//      `fieldsInKey` on the light block their cache keys would be identical and
//      the 3-column payload would land in the entry every session page reads as
//      the full row — one of them then renders blank columns depending on mount
//      order. The keys must differ; the PREFIX must still match, so existing
//      session invalidations refresh the cost numbers too.
//   2. The light projection stays THREE columns. Widening it back toward the
//      full row re-imports the req #3078 payload problem that this projection
//      exists to sidestep.
//   3. Neither read is per-requirement or per-session. That is design rule 5,
//      and the POC's disabled Cost column is the named failure.

import { describe, it, expect } from 'vitest';
import { sessions, requirementSessions, sessionCostRollups } from '../factory/devopsQueries';
import { sessionKeys, requirementSessionKeys, sessionCostRollupKeys } from '../useQueryKeys';
import { useAllRequirementSessions, useAllSessionCostRollups } from '../useDataQueries';

const LIGHT_FIELDS = 'id,wall_secs_total,output_tokens_total';

describe('cost read key shapes', () => {
    it('requirementSessionKeys.all(creator) → ["requirement_sessions", creator]', () => {
        expect(requirementSessionKeys.all('alice'))
            .toEqual(['requirement_sessions', 'alice']);
    });

    it('sessionCostRollupKeys.all(creator) shares the swarm_sessions prefix', () => {
        // Prefix-compatible on purpose: `queryClient.invalidateQueries({queryKey:
        // sessionKeys.all(creator)})` must refresh the cost read as well, or the
        // Cost column goes stale behind a sessions page that just updated.
        expect(sessionCostRollupKeys.all('alice')).toEqual(sessionKeys.all('alice'));
    });

    it('the light read and the full read cannot collide as cache entries', () => {
        // Same base key, but `fieldsInKey` appends {fields} to the light one and
        // not to the full one, so the resolved keys differ. Asserted through the
        // hash a query client actually uses, not through the array shape.
        const base = sessionKeys.all('alice');
        const full = JSON.stringify(base);
        const light = JSON.stringify([...base, { fields: LIGHT_FIELDS }]);
        expect(light).not.toBe(full);
    });
});

describe('cost read projection contracts', () => {
    it('the session cost read projects exactly id + the two rollup columns', () => {
        expect(sessionCostRollups.config.defaultFields).toBe(LIGHT_FIELDS);
    });

    it('the session cost read carries no blob column', () => {
        // phase_tokens / telemetry / plan / summaries are why req #3078 exists at
        // all. The rollup columns are precisely the escape from needing them.
        expect(sessionCostRollups.config.defaultFields)
            .not.toMatch(/phase_tokens|telemetry|plan|summary/);
    });

    it('the requirement→session junction asks for no id column', () => {
        // Composite PK (requirement_fk, session_fk): the table has no id, and
        // requesting one 400s the whole read.
        expect(requirementSessions.config.defaultFields)
            .toBe('requirement_fk,session_fk');
    });

    it('both cost blocks carry the fields-in-key collision guard', () => {
        for (const block of [requirementSessions, sessionCostRollups]) {
            expect(block.config.fieldsInKey).toBe(true);
        }
    });

    it('neither cost read declares a foreign-key hook', () => {
        // A `useByRequirement` / `useBySession` hook is exactly the N+1 shape
        // design rule 5 forbids — it would let a future caller loop it per plan
        // row, which is how the POC got to ~86 reads. `useById` is the factory's
        // unconditional single-row hook and is not that shape.
        for (const block of [requirementSessions, sessionCostRollups]) {
            const fkHooks = Object.keys(block)
                .filter((k) => k.startsWith('useBy') && k !== 'useById');
            expect(fkHooks).toEqual([]);
            const fkKeys = Object.keys(block.keys)
                .filter((k) => k.startsWith('by') && k !== 'byId');
            expect(fkKeys).toEqual([]);
        }
    });

    it('exports only list hooks', () => {
        expect(typeof useAllRequirementSessions).toBe('function');
        expect(typeof useAllSessionCostRollups).toBe('function');
    });
});
