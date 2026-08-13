import { describe, it, expect, vi } from 'vitest';
import {
    sortSwarmReadyItems,
    getCoordLabel,
    tallyRequirementStatuses,
} from '../swarmStartCardUtils';

// ── req #3502 — the tally takes ONE predicate, and it is the shared one ──────
//
// This file used to describe TWO exclusions: `aggregatorRowVisible`'s
// unconditional launch exclusion (req #3180, per-chip, no toggle) and the
// browse toggle layered on top. The first is DELETED — measured on production,
// it meant the orchestrated toggle could not reach three of the aggregator's
// five chips while every other surface obeyed it. The tally now takes
// `useRequirementVisibility().isVisible` directly, which is the same function
// object the card filters its rows with.
//
// `visible(ids, hide)` reproduces exactly what that hook returns, so the
// assertions below exercise the real predicate shape rather than a stand-in
// with its own rules.
const visible = (ids, hide = false) =>
    (row) => !hide || !ids || !ids.has(Number(row?.id));

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

const ALL_CHIPS = ['authoring', 'approved', 'swarm_ready', 'development', 'met'];

// req #3502 — the decision a future reader is likeliest to try to "restore":
// that the three PRE-LAUNCH chips filter differently from the two observation
// chips. They do not. The toggle is the whole rule, on every chip, and these
// cases pin that by asserting the two groups behave IDENTICALLY.
describe('tallyRequirementStatuses', () => {
    const rows = [
        req(1, { requirement_status: 'authoring' }),
        req(2, { requirement_status: 'authoring' }),
        req(3, { requirement_status: 'approved' }),
        req(4, { requirement_status: 'swarm_ready' }),
        req(5, { requirement_status: 'development' }),
        req(6, { requirement_status: 'met' }),
    ];

    it('counts every chip when the predicate hides nothing', () => {
        const { counts } = tallyRequirementStatuses(rows, ALL_CHIPS, visible(new Set()));
        expect(counts).toEqual({
            authoring: 2, approved: 1, swarm_ready: 1, development: 1, met: 1,
        });
    });

    it('counts every chip when orchestrated work is on screen (toggle OFF)', () => {
        // THE REGRESSION THIS REQUIREMENT WAS FILED FOR. Every row here is
        // step-carried; with the toggle off the reader asked to see them, and
        // the launch chips must show them exactly as the observation chips do.
        const { counts, hidden } = tallyRequirementStatuses(
            rows, ALL_CHIPS, visible(new Set([1, 2, 3, 4, 5, 6]), false));
        expect(counts).toEqual({
            authoring: 2, approved: 1, swarm_ready: 1, development: 1, met: 1,
        });
        for (const s of ALL_CHIPS) expect(hidden[s]).toBe(0);
    });

    it('hides orchestrated work on EVERY chip when the toggle is ON', () => {
        const { counts, hidden } = tallyRequirementStatuses(
            rows, ALL_CHIPS, visible(new Set([1, 2, 3, 4, 5, 6]), true));
        expect(counts).toEqual({
            authoring: 0, approved: 0, swarm_ready: 0, development: 0, met: 0,
        });
        expect(hidden).toEqual({
            authoring: 2, approved: 1, swarm_ready: 1, development: 1, met: 1,
        });
    });

    it('treats a launch chip and an observation chip identically', () => {
        // The two groups differed for four requirements' worth of history. If
        // this ever fails, a per-chip rule has come back.
        const ids = new Set([4, 5]);          // one swarm_ready, one development
        const onScreen = tallyRequirementStatuses(rows, ALL_CHIPS, visible(ids, false));
        const hiddenState = tallyRequirementStatuses(rows, ALL_CHIPS, visible(ids, true));
        expect(onScreen.counts.swarm_ready).toBe(1);
        expect(onScreen.counts.development).toBe(1);
        expect(hiddenState.counts.swarm_ready).toBe(0);
        expect(hiddenState.counts.development).toBe(0);
    });

    it('never counts the template row', () => {
        // id === '' is the "type a title here" row, not a requirement — and
        // Number('') is 0, which must never reach the Set lookup.
        const withTemplate = [...rows, { id: '', requirement_status: 'authoring' }];
        const { counts } = tallyRequirementStatuses(
            withTemplate, ALL_CHIPS, visible(new Set([0]), true));
        expect(counts.authoring).toBe(2);
    });

    it('matches a numeric Set against string row ids', () => {
        const { counts } = tallyRequirementStatuses(
            [{ id: '4', requirement_status: 'swarm_ready' }], ALL_CHIPS,
            visible(new Set([4]), true));
        expect(counts.swarm_ready).toBe(0);
    });

    it('ignores statuses outside the chip vocabulary', () => {
        const { counts } = tallyRequirementStatuses(
            [...rows, req(9, { requirement_status: 'wontfix' })], ALL_CHIPS, visible(new Set()));
        expect(counts.wontfix).toBeUndefined();
        expect(Object.keys(counts)).toEqual(ALL_CHIPS);
    });

    it('returns a zeroed map for a missing read', () => {
        // The in-flight state. Showing MORE than we eventually will is the
        // deliberate direction — never hide eligible work behind a pending fetch.
        const { counts } = tallyRequirementStatuses(
            undefined, ALL_CHIPS, visible(new Set([1]), true));
        expect(counts).toEqual({
            authoring: 0, approved: 0, swarm_ready: 0, development: 0, met: 0,
        });
    });

    it('counts everything when no predicate is supplied at all', () => {
        // Same failure direction as above: an absent rule shows work, never
        // withholds it.
        const { counts } = tallyRequirementStatuses(rows, ALL_CHIPS);
        expect(counts.swarm_ready).toBe(1);
        expect(counts.development).toBe(1);
    });

    it('counts everything when handed a non-function third argument, and SAYS SO', () => {
        // The pre-#3502 call site passed an OBJECT here. A stale caller must
        // degrade to "show everything", not to "hide everything" — but it must
        // not do it SILENTLY: the state it produces is a filtered list under an
        // unfiltered count, which is the defect this file exists to prevent, and
        // it would ship looking fine. Omitting the argument is a supported call
        // and stays quiet; passing a non-predicate is a bug and complains.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { counts } = tallyRequirementStatuses(rows, ALL_CHIPS, { orchestratedIds: new Set([4]) });
            expect(counts.swarm_ready).toBe(1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain('isVisible');

            warn.mockClear();
            tallyRequirementStatuses(rows, ALL_CHIPS);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('count + hidden always sums to the population', () => {
        const { counts, hidden } = tallyRequirementStatuses(
            rows, ALL_CHIPS, visible(new Set([1, 2, 3, 4, 5, 6]), true));
        for (const s of ALL_CHIPS) {
            const total = rows.filter(r => r.requirement_status === s).length;
            expect(counts[s] + hidden[s]).toBe(total);
        }
    });
});

describe('the badge cannot disagree with the rows (req #3419, req #3502)', () => {
    // This is the property the shared predicate buys. Asserting it by OUTCOME —
    // count the rows the card would render, compare to the badge — is the only
    // form that stays true if someone re-inlines one of the two.
    const ROWS = [
        req(10, { requirement_status: 'swarm_ready' }),
        req(20, { requirement_status: 'swarm_ready' }),
        req(30, { requirement_status: 'swarm_ready' }),
        req(40, { requirement_status: 'development' }),
        req(50, { requirement_status: 'development' }),
    ];
    const CHIPS = ['authoring', 'approved', 'swarm_ready', 'development', 'met'];
    const ORCHESTRATED = new Set([10, 20, 40]);

    it.each([false, true])('agrees per chip with the toggle at %s', (hide) => {
        const isVisible = visible(ORCHESTRATED, hide);
        const { counts } = tallyRequirementStatuses(ROWS, CHIPS, isVisible);
        for (const status of CHIPS) {
            const rendered = ROWS
                .filter(r => r.requirement_status === status)
                .filter(isVisible);
            expect(counts[status]).toBe(rendered.length);
        }
    });
});
