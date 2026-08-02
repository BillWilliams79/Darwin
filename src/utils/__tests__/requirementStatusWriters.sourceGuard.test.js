// req #3244 — belt-and-suspenders guard against the failure mode a plain PUT-body
// assertion can't catch: swapping `requirementStatusTimestampState` (real `null`,
// for local/cache state) for `requirementStatusTimestampFields` (the 'NULL'
// sentinel, PUT-body-only) at an optimistic-update call site would write the
// literal string 'NULL' into every requirement cache, but the component tests
// only inspect the network PUT body and would stay green. Nothing in the
// rendered DOM surfaces started_at/completed_at/deferred_at to assert against
// directly (see RequirementRow.jsx), so this checks the call shape in source
// instead of leaving the swap undetectable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relPath) => readFileSync(join(here, relPath), 'utf8');

describe('requirement_status writers use the right timestamp helper at each call site', () => {
    for (const [label, relPath] of [
        ['CategoryCard.jsx', '../../SwarmView/CategoryCard.jsx'],
        ['SwarmStartCard.jsx', '../../TaskPlanView/SwarmStartCard.jsx'],
    ]) {
        it(`${label}: optimistic cache/local writes use requirementStatusTimestampState`, () => {
            const src = read(relPath);
            expect(src).toMatch(/writeThroughRequirementCaches\(requirementId, \{ requirement_status: next, \.\.\.timestampState \}\)/);
            expect(src).toMatch(/i === requirementIndex \? \{ \.\.\.r, requirement_status: next, \.\.\.timestampState \} : r/);
        });

        it(`${label}: the PUT body uses requirementStatusTimestampFields`, () => {
            const src = read(relPath);
            expect(src).toMatch(/'?requirement_status'?: next, \.\.\.timestampFields/);
        });
    }
});
