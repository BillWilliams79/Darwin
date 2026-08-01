import { describe, it, expect } from 'vitest';
import {
    sortSwarmReadyItems,
    getCoordLabel,
    PIPELINE_FILTERED_STATUSES,
    tallyRequirementStatuses,
} from '../swarmStartCardUtils';

const req = (id, overrides = {}) => ({
    id,
    title: `Requirement ${id}`,
    requirement_status: 'swarm_ready',
    coordination_type: overrides.coordination_type ?? null,
    ...overrides,
});

describe('sortSwarmReadyItems', () => {
    it('sorts by id ascending (chronological)', () => {
        const items = [req(30), req(10), req(20)];
        const sorted = sortSwarmReadyItems(items);
        expect(sorted.map(i => i.id)).toEqual([10, 20, 30]);
    });

    it('returns empty array when input is empty', () => {
        expect(sortSwarmReadyItems([])).toEqual([]);
    });

    it('returns single-element array unchanged', () => {
        const items = [req(42)];
        const sorted = sortSwarmReadyItems(items);
        expect(sorted.map(i => i.id)).toEqual([42]);
    });

    it('does not mutate the original array', () => {
        const items = [req(3), req(1), req(2)];
        const original = [...items];
        sortSwarmReadyItems(items);
        expect(items.map(i => i.id)).toEqual(original.map(i => i.id));
    });

    it('handles already-sorted input', () => {
        const items = [req(1), req(2), req(3)];
        const sorted = sortSwarmReadyItems(items);
        expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
    });
});

describe('getCoordLabel', () => {
    it('returns Discuss Req for discuss', () => {
        expect(getCoordLabel('discuss')).toBe('Discuss Req');
    });

    it('returns Planned for planned', () => {
        expect(getCoordLabel('planned')).toBe('Planned');
    });

    it('returns Implemented for implemented', () => {
        expect(getCoordLabel('implemented')).toBe('Implemented');
    });

    it('returns Deployed for deployed', () => {
        expect(getCoordLabel('deployed')).toBe('Deployed');
    });

    it('returns No autonomy for null', () => {
        expect(getCoordLabel(null)).toBe('No autonomy');
    });

    it('returns No autonomy for undefined', () => {
        expect(getCoordLabel(undefined)).toBe('No autonomy');
    });

    it('returns No autonomy for unknown value', () => {
        expect(getCoordLabel('unknown')).toBe('No autonomy');
    });
});

// req #3180 — the aggregator's pipeline exclusion. These pin the decision a
// future reader is likeliest to "simplify": WHICH chips filter. The card offers
// requirements for a direct swarm-start, so a requirement a pipeline step
// carries is excluded from the launch chips — but `development` and `met` are
// observation surfaces, not offers, and filtering them empties the two chips the
// user watches work through.

const ALL_CHIPS = ['authoring', 'approved', 'swarm_ready', 'development', 'met'];

describe('PIPELINE_FILTERED_STATUSES', () => {
    it('is the three PRE-LAUNCH statuses — the chips that offer a launch', () => {
        expect(PIPELINE_FILTERED_STATUSES).toEqual(['authoring', 'approved', 'swarm_ready']);
    });

    it('excludes development and met — observation surfaces, not offers', () => {
        // Measured on the live plan, 7 of 7 `development` requirements are
        // plan-carried; filtering that chip would blank it entirely.
        expect(PIPELINE_FILTERED_STATUSES).not.toContain('development');
        expect(PIPELINE_FILTERED_STATUSES).not.toContain('met');
    });
});

describe('tallyRequirementStatuses', () => {
    const rows = [
        req(1, { requirement_status: 'authoring' }),
        req(2, { requirement_status: 'authoring' }),
        req(3, { requirement_status: 'approved' }),
        req(4, { requirement_status: 'swarm_ready' }),
        req(5, { requirement_status: 'development' }),
        req(6, { requirement_status: 'met' }),
    ];

    it('counts every chip and hides nothing when no requirement is pipelined', () => {
        const { counts, hidden } = tallyRequirementStatuses(rows, ALL_CHIPS, new Set());
        expect(counts).toEqual({
            authoring: 2, approved: 1, swarm_ready: 1, development: 1, met: 1,
        });
        expect(Object.values(hidden).every(n => n === 0)).toBe(true);
    });

    it('moves a pipelined launch-chip requirement from counts into hidden', () => {
        const { counts, hidden } = tallyRequirementStatuses(rows, ALL_CHIPS, new Set([2, 4]));
        expect(counts.authoring).toBe(1);
        expect(hidden.authoring).toBe(1);
        expect(counts.swarm_ready).toBe(0);
        expect(hidden.swarm_ready).toBe(1);
    });

    it('leaves development and met counted even when pipelined', () => {
        // THE decision. If this test starts failing because someone made the
        // exclusion uniform, the Development chip has just gone blank.
        const { counts, hidden } = tallyRequirementStatuses(rows, ALL_CHIPS, new Set([5, 6]));
        expect(counts.development).toBe(1);
        expect(counts.met).toBe(1);
        expect(hidden.development).toBe(0);
        expect(hidden.met).toBe(0);
    });

    it('keeps count + hidden summing to the population, so the note is exact', () => {
        // `hidden[s]` is the number of rows dropped from that chip's LIST, which
        // is only true while count and list read the same population.
        const { counts, hidden } = tallyRequirementStatuses(rows, ALL_CHIPS, new Set([1, 2, 3, 4]));
        for (const s of ALL_CHIPS) {
            const total = rows.filter(r => r.requirement_status === s).length;
            expect(counts[s] + hidden[s]).toBe(total);
        }
    });

    it('never counts the template row', () => {
        // id === '' is the "type a title here" row, not a requirement — and
        // Number('') is 0, which must never reach the Set lookup.
        const withTemplate = [...rows, { id: '', requirement_status: 'authoring' }];
        const { counts } = tallyRequirementStatuses(withTemplate, ALL_CHIPS, new Set([0]));
        expect(counts.authoring).toBe(2);
    });

    it('matches a numeric Set against string row ids', () => {
        const { counts, hidden } = tallyRequirementStatuses(
            [{ id: '4', requirement_status: 'swarm_ready' }], ALL_CHIPS, new Set([4]));
        expect(counts.swarm_ready).toBe(0);
        expect(hidden.swarm_ready).toBe(1);
    });

    it('ignores statuses outside the chip vocabulary', () => {
        const { counts } = tallyRequirementStatuses(
            [...rows, req(9, { requirement_status: 'wontfix' })], ALL_CHIPS, new Set());
        expect(counts.wontfix).toBeUndefined();
        expect(Object.keys(counts)).toEqual(ALL_CHIPS);
    });

    it('returns zeroed maps for a missing read, hiding nothing', () => {
        // The in-flight state. Showing MORE than we eventually will is the
        // deliberate direction — never hide eligible work behind a pending fetch.
        const { counts, hidden } = tallyRequirementStatuses(undefined, ALL_CHIPS, new Set([1]));
        expect(counts).toEqual({
            authoring: 0, approved: 0, swarm_ready: 0, development: 0, met: 0,
        });
        expect(hidden.authoring).toBe(0);
    });

    it('tolerates a missing pipelined Set', () => {
        const { counts } = tallyRequirementStatuses(rows, ALL_CHIPS, undefined);
        expect(counts.swarm_ready).toBe(1);
    });
});
