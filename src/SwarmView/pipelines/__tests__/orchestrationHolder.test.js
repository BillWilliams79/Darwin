// orchestrationHolder.test.js — req #3224.
//
// The browser cannot import `darwin-mcp/services/orchestration_claims.py`, so it
// re-derives two facts the daemon derives for its own consumers: how long ago a
// reservation last proved it was alive, and whether that is past the reclaim
// threshold. These tests pin the places the two could silently disagree — a UI
// that called a claim live while the engine called it reclaimable would be worse
// than showing nothing at all.

import { describe, it, expect } from 'vitest';

import {
    STALE_AFTER_SECONDS,
    claimForPipeline,
    claimForPipeline2,
    claimsForEpic,
    heartbeatAgeSeconds,
    heldForSeconds,
    holderView,
    humanDuration,
    isStale,
    parseUtc,
    scopeLabel,
} from '../orchestrationHolder';

const MACHINES = [
    { id: 4, title: 'Mac mini', hostname: 'mac-mini' },
    { id: 5, title: '', hostname: 'wsl-box' },
];

const NOW = new Date('2026-08-01T12:00:00Z');

function claim(over = {}) {
    return {
        id: 1,
        pipeline_fk: 2,
        epic_fk: null,
        machine_fk: 4,
        terminal_pid: 41234,
        engine_pid: 55012,
        polls: 12,
        claimed_at: '2026-08-01 10:00:00',
        update_ts: '2026-08-01 11:59:30',
        ...over,
    };
}

describe('parseUtc', () => {
    it('reads a MySQL datetime as UTC, not as local time', () => {
        // THE bug this exists to prevent. Lambda-Rest sends
        // `YYYY-MM-DD HH:MM:SS` with no zone and RDS runs in UTC, but
        // `new Date('2026-08-01 10:00:00')` is parsed as LOCAL by every browser.
        // Without the normalization a user eight hours off UTC reads every
        // fresh reservation as eight hours stale — i.e. as dead.
        expect(parseUtc('2026-08-01 10:00:00').toISOString())
            .toBe('2026-08-01T10:00:00.000Z');
    });

    it('leaves an explicit zone alone', () => {
        expect(parseUtc('2026-08-01T10:00:00Z').toISOString())
            .toBe('2026-08-01T10:00:00.000Z');
    });

    it('answers null for anything it cannot read', () => {
        expect(parseUtc(null)).toBeNull();
        expect(parseUtc('')).toBeNull();
        expect(parseUtc('not-a-timestamp')).toBeNull();
    });
});

describe('heartbeat age', () => {
    it('measures from the heartbeat, not from the claim', () => {
        // A long-running healthy engine has an OLD claimed_at and a fresh
        // update_ts. Measuring from the claim would call every scope stale after
        // ten minutes of perfectly correct orchestration.
        expect(heartbeatAgeSeconds(claim(), NOW)).toBe(30);
        expect(heldForSeconds(claim(), NOW)).toBe(7200);
        expect(isStale(claim(), NOW)).toBe(false);
    });

    it('falls back to claimed_at before the first heartbeat', () => {
        // `update_ts` is NULL until the first heartbeat lands — TIMESTAMP NULL
        // ON UPDATE has no DEFAULT — so a just-claimed scope would otherwise
        // read as infinitely stale.
        const fresh = claim({ update_ts: null, claimed_at: '2026-08-01 11:59:55' });
        expect(heartbeatAgeSeconds(fresh, NOW)).toBe(5);
        expect(isStale(fresh, NOW)).toBe(false);
    });

    it('is stale only PAST the threshold, never at it', () => {
        const at = claim({ update_ts: '2026-08-01 11:50:00' });     // exactly 600s
        expect(heartbeatAgeSeconds(at, NOW)).toBe(STALE_AFTER_SECONDS);
        expect(isStale(at, NOW)).toBe(false);
        const past = claim({ update_ts: '2026-08-01 11:49:59' });
        expect(isStale(past, NOW)).toBe(true);
    });

    it('treats an unreadable stamp as NOT stale', () => {
        // "Cannot say" is not "go ahead and reclaim". Same rule the server
        // applies: calling a claim dead on an unreadable timestamp is how a live
        // orchestrator's scope gets taken.
        const broken = claim({ update_ts: 'nonsense', claimed_at: 'nonsense' });
        expect(heartbeatAgeSeconds(broken, NOW)).toBeNull();
        expect(isStale(broken, NOW)).toBe(false);
    });
});

describe('scope selection', () => {
    const claims = [
        claim({ id: 1, pipeline_fk: 2, epic_fk: null }),
        claim({ id: 2, pipeline_fk: 2, epic_fk: 7 }),
        claim({ id: 3, pipeline_fk: 9, epic_fk: null }),
    ];

    it('claimForPipeline finds only the WHOLE-PLAN reservation', () => {
        // An epic-scoped claim is a different and weaker statement ("a slice of
        // this plan is being orchestrated"); reporting it as the plan's holder
        // would overstate what is running.
        expect(claimForPipeline(claims, 2).id).toBe(1);
        expect(claimForPipeline(claims, 9).id).toBe(3);
        expect(claimForPipeline(claims, 42)).toBeNull();
        expect(claimForPipeline(claims, null)).toBeNull();
    });

    it('claimsForEpic finds the epic\'s own reservation', () => {
        expect(claimsForEpic(claims, 7).map(c => c.id)).toEqual([2]);
        expect(claimsForEpic(claims, 8)).toEqual([]);
    });

    it('claimsForEpic ALSO finds a whole-plan reservation on a plan it is seated in', () => {
        // A whole-plan scope owns EVERY step in its plan (design rule 10 gives a
        // step exactly one dominant label), so an epic whose work is being
        // launched right now by a whole-plan engine is orchestrated — reporting
        // it as free is the confusion the shared reservation exists to remove.
        expect(claimsForEpic(claims, 7, [2]).map(c => c.id).sort()).toEqual([1, 2]);
        expect(claimsForEpic(claims, 8, [2]).map(c => c.id)).toEqual([1]);
        expect(claimsForEpic(claims, 8, [42])).toEqual([]);
    });

    it('renders the same scope words the engine uses', () => {
        expect(scopeLabel(claims[0])).toBe('pipeline:2');
        expect(scopeLabel(claims[1])).toBe('epic:7@2');
    });
});

describe('scope selection — 2.0 (req #3381 code review)', () => {
    // `pipeline2_fk`/`epic2_fk` are the SEPARATE columns a 2.0-scoped claim
    // carries — NULL on a 1.0 row, and vice versa. `claim()`'s default
    // fixture above never sets them, matching an un-widened
    // `useOrchestrationClaims` read or a genuine 1.0 claim: both must read
    // as `undefined`, not as a 2.0 scope of pipeline `undefined`.
    const claims = [
        claim({ id: 10, pipeline_fk: null, epic_fk: null, pipeline2_fk: 6, epic2_fk: null }),
        claim({ id: 11, pipeline_fk: null, epic_fk: null, pipeline2_fk: 6, epic2_fk: 9 }),
        claim({ id: 12, pipeline_fk: 2, epic_fk: null }),   // a 1.0 claim, unchanged
    ];

    it('claimForPipeline2 finds only the WHOLE-PLAN 2.0 reservation', () => {
        expect(claimForPipeline2(claims, 6).id).toBe(10);
        expect(claimForPipeline2(claims, 42)).toBeNull();
        expect(claimForPipeline2(claims, null)).toBeNull();
    });

    it('claimForPipeline2 never matches a 1.0-only claim (pipeline2_fk absent)', () => {
        // The bug this guards: `undefined === 6` is false, so a 1.0 claim
        // must not accidentally satisfy a 2.0 lookup for the same numeric id.
        expect(claimForPipeline2([claims[2]], 2)).toBeNull();
    });

    it('claimForPipeline never matches a 2.0-only claim (pipeline_fk absent)', () => {
        expect(claimForPipeline([claims[0], claims[1]], 6)).toBeNull();
    });

    it('scopeLabel renders pipeline2:/epic2: for a 2.0 claim', () => {
        expect(scopeLabel(claims[0])).toBe('pipeline2:6');
        expect(scopeLabel(claims[1])).toBe('epic2:9@6');
    });

    it('scopeLabel still renders pipeline:/epic: for a 1.0 claim, unaffected', () => {
        expect(scopeLabel(claims[2])).toBe('pipeline:2');
    });
});

describe('humanDuration', () => {
    it('scales from seconds to days', () => {
        expect(humanDuration(43)).toBe('43s');
        expect(humanDuration(432)).toBe('7m');
        expect(humanDuration(7325)).toBe('2h 02m');
        expect(humanDuration(360000)).toBe('4d 4h');
    });
});

describe('holderView', () => {
    it('names the machine, the terminal, the engine and the age', () => {
        // The half of req #3224 that exists for a HUMAN rather than for the
        // engine: a user must be able to tell a plan is being orchestrated from
        // the other machine, and which window to go and look at, without leaving
        // the page.
        const view = holderView(claim(), MACHINES, NOW);
        expect(view.machine).toBe('Mac mini');
        expect(view.label).toBe('Mac mini · 2h 00m');
        expect(view.stale).toBe(false);
        expect(view.title).toContain('pipeline:2 is being orchestrated from Mac mini');
        expect(view.title).toContain('terminal pid 41234');
        expect(view.title).toContain('engine pid 55012');
        expect(view.title).toContain('held for 2h 00m');
        expect(view.title).toContain('last alive 30s ago');
    });

    it('falls back to the hostname, then to the id, then to a noun', () => {
        expect(holderView(claim({ machine_fk: 5 }), MACHINES, NOW).machine).toBe('wsl-box');
        expect(holderView(claim({ machine_fk: 9 }), MACHINES, NOW).machine).toBe('machine 9');
        expect(holderView(claim({ machine_fk: null }), MACHINES, NOW).machine)
            .toBe('an unnamed machine');
    });

    it('says what a STALE reservation means, not merely that it is old', () => {
        const view = holderView(claim({ update_ts: '2026-08-01 11:00:00' }), MACHINES, NOW);
        expect(view.stale).toBe(true);
        expect(view.label).toBe('Mac mini (stale)');
        expect(view.title).toContain('its orchestrator is gone');
        expect(view.title).toContain('any machine may reclaim this scope');
    });

    it('is null when nothing holds the scope', () => {
        // The consumers render nothing at all in this case. An empty chip would
        // be a claim about the world; a blank is the absence of one.
        expect(holderView(null, MACHINES, NOW)).toBeNull();
        expect(holderView(undefined, MACHINES, NOW)).toBeNull();
    });
});
