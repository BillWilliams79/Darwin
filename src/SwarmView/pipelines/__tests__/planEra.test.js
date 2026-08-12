// planEra.test.js — the route↔entity binding, and THE GUARD (req #3463).
//
// The last `describe` in this file is the mechanical reason req #3462's class
// of outage cannot recur. It is not a unit test of a function: it reads the
// whole of `src/` off disk and fails if any file other than `planEra.js` spells
// a plan route as a string. Everything else here is ordinary coverage of the
// module that test forces everyone through.
//
// ── req #3356: ONE ERA, AND THE GUARD IS WHAT SURVIVES ─────────────────────
// This file used to assert that the two eras produced DIFFERENT routes, that an
// unknown era THREW, and that `planEraOfSession` read the era off whichever
// column carried the seat. Pipeline 1.0 is eradicated: `PLAN_ERA_1`/`_2`,
// `PLAN_ERAS`, `DEFAULT_PLAN_ERA`, `isPlanEra`, `planEraBinding`,
// `planEraLabel` and `planEraOfSession` are all gone, so those cases are gone
// with them rather than being repaired into tautologies about a single value.
//
// THE GUARD IS UNTOUCHED AND IS THE POINT. Its value was never the branching —
// it is that a plan route is spelled in exactly one file — and that is a
// stronger claim now, not a weaker one: with one era there is no longer even a
// second legitimate spelling to confuse an offender with.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    normalizePlanId,
    planDetailPath,
    planDetailPathPattern,
    planDetailRoutePath,
    planEntityName,
    planListPath,
    planListRoutePath,
    planStorageNamespace,
} from '../planEra';

describe('the binding', () => {
    it('binds the plan surface to its route, entity and storage namespace', () => {
        expect(planListPath()).toBe('/swarm/pipelines');
        expect(planDetailPath(7)).toBe('/swarm/pipeline/7');
        expect(planEntityName()).toBe('pipelines');
        expect(planStorageNamespace()).toBe('plan-view');
    });

    it('carries NO era marker anywhere in the binding (req #3356)', () => {
        // The eradication, as an assertion. Every value this module hands out is
        // a string a reader SEES — in the address bar, in the not-found alert,
        // or as a web-storage key — so a stray `2` here is a user-visible
        // leftover, not an internal detail.
        for (const value of [planListPath(), planDetailPath(7), planEntityName(),
            planStorageNamespace(), planListRoutePath(), planDetailRoutePath()]) {
            expect(value).not.toMatch(/2/);
        }
    });

    it('keeps the list and detail routes distinguishable', () => {
        // They differ by ONE character and share a prefix, which is exactly why
        // the pattern below is anchored and demands a digits-only id segment.
        expect(planListPath()).not.toBe(planDetailPath(7));
        expect(planDetailPathPattern().test(planListPath())).toBe(false);
    });
});

describe('planDetailPath — id handling', () => {
    it('returns null rather than a dead link for an unusable id', () => {
        // `Number(null)` and `Number('')` are both 0, and 0 is a perfectly good
        // integer — a plan id that never resolved would otherwise produce a
        // confident link to plan 0, rendering the not-found alert as though the
        // DATA were at fault. `Number([])` is 0 and `Number(true)` is 1, so the
        // guard is a type whitelist rather than a nullish check.
        for (const bad of [null, undefined, '', 'abc', '12abc', 1.5, NaN, {}, [], true]) {
            expect(planDetailPath(bad)).toBeNull();
        }
    });

    it('accepts 0 and a numeric string, because both are real ids', () => {
        expect(planDetailPath(0)).toBe('/swarm/pipeline/0');
        expect(planDetailPath('79')).toBe('/swarm/pipeline/79');
    });

    it('appends a query string only when one is given', () => {
        expect(planDetailPath(2, 'mode=table&step=9'))
            .toBe('/swarm/pipeline/2?mode=table&step=9');
        expect(planDetailPath(2, null)).toBe('/swarm/pipeline/2');
        expect(planDetailPath(2, '')).toBe('/swarm/pipeline/2');
    });

    it('normalizePlanId is the same guard the builder applies', () => {
        expect(normalizePlanId('79')).toBe(79);
        expect(normalizePlanId(0)).toBe(0);
        expect(normalizePlanId('')).toBeNull();
        expect(normalizePlanId(null)).toBeNull();
        expect(normalizePlanId('12abc')).toBeNull();
    });
});

describe('planDetailPathPattern', () => {
    it('matches a plan detail path', () => {
        expect(planDetailPathPattern().test('/swarm/pipeline/2')).toBe(true);
    });

    it('never matches a LIST path — they differ by one character', () => {
        expect(planDetailPathPattern().test('/swarm/pipelines')).toBe(false);
    });

    it('never matches the RETIRED 2.0 routes (req #3356)', () => {
        // A reader with an old bookmark or an old localStorage record must not
        // be treated as standing on a plan page. `pipelinePlace.js` uses this
        // pattern as its resume gate's anti-bounce test, and a false positive
        // there makes the list unreachable.
        expect(planDetailPathPattern().test('/swarm/pipeline2/7')).toBe(false);
        expect(planDetailPathPattern().test('/swarm/pipelines2')).toBe(false);
    });

    it('requires a digits-only id segment and nothing after it', () => {
        const re = planDetailPathPattern();
        expect(re.test('/swarm/pipeline/2/')).toBe(true);
        expect(re.test('/swarm/pipeline/2/anything')).toBe(false);
        expect(re.test('/swarm/pipeline/abc')).toBe(false);
        expect(re.test('/x/swarm/pipeline/2')).toBe(false);
    });

    it('agrees with the builder — derived from one literal, not two', () => {
        expect(planDetailPathPattern().test(planDetailPath(42))).toBe(true);
    });
});

describe('route declarations', () => {
    it('gives index.jsx the same routes the builders emit', () => {
        // A matcher and a builder that state the route separately are how a
        // rename breaks the guard while the link keeps working. `index.jsx`
        // declares from these, so there is one literal per route in the app.
        expect(planListRoutePath()).toBe('swarm/pipelines');
        expect(planDetailRoutePath()).toBe('swarm/pipeline/:id');
    });

    it('route paths are the link paths without the leading slash', () => {
        expect(`/${planListRoutePath()}`).toBe(planListPath());
        expect(`/${planDetailRoutePath()}`)
            .toBe(planDetailPath(0).replace('/0', '/:id'));
    });
});

// ── THE GUARD (req #3463 acceptance 5) ─────────────────────────────────────
//
// req #3462's root cause was that "which era does this page READ?" and "which
// era do this page's LINKS point at?" were two facts kept in different files.
// req #3381 changed the first and not the second, and every entry point into
// the plan page 404'd.
//
// `planEra.js` makes them one fact. THIS TEST is what makes that binding
// binding: if any other file in `src/` spells a plan route, it fails. There is
// then no way to re-point a page's data source without re-pointing its links,
// because there is nothing to edit twice — the era is one value and it decides
// both.
//
// IT IS A SOURCE SCAN AND NOT A LINT RULE because this package has no eslint
// (see `PipelineDetail.jsx`'s own note on that), and a guarantee that depends on
// a tool nobody runs is not a guarantee. `npm run test:unit` runs this.
describe('THE GUARD — no file outside planEra.js spells a plan route', () => {
    const HERE = fileURLToPath(new URL('.', import.meta.url));
    const SRC = join(HERE, '..', '..', '..');   // __tests__ → pipelines → SwarmView → src

    // The one PRODUCTION file allowed to name these routes, relative to `src/`,
    // in POSIX form.
    const ALLOWED = new Set([
        'SwarmView/pipelines/planEra.js',
    ]);

    // `__tests__` IS EXEMPT, and deliberately so. A test that asserted
    // `stepLinkTo(2, 47) === planDetailPath(1, 2, '…')` would be comparing the
    // implementation against itself and would pass however wrong both were —
    // the literal in a test is the PIN, and banning it would delete the only
    // place the route's actual spelling is written down twice on purpose. The
    // guard is about SHIPPING code, which is where the two facts can drift.
    const isTest = (rel) => rel.split('/').includes('__tests__');

    // Anything that looks like a plan route inside SOURCE (comments stripped).
    // Both eras, list and detail, with or without a leading slash — the last of
    // those catches the React Router `path=` form.
    const ROUTE = /\/?swarm\/pipelines?2?\b/;

    // Comments are STRIPPED, not matched around. Every file in this directory
    // documents its own routes in prose — `pipelinePlace.js` reasons about
    // `/swarm/pipelines` vs `/swarm/pipeline/2` at length — and a guard that
    // banned the words rather than the CODE would be a guard nobody could write
    // a comment past, which is how guards get deleted.
    //
    // A BLOCK COMMENT IS REPLACED BY ITS OWN NEWLINES, not by a space (code
    // review). Collapsing a multi-line comment to one character shifts every
    // line number after it, so the offender list below pointed at the wrong
    // lines — the findings were right and the pointers were not, which is the
    // worst way for a guard to be read.
    function stripComments(source) {
        return source
            .replace(/\/\*[\s\S]*?\*\//g,
                (m) => m.replace(/[^\n]/g, ' '))   // block comments, incl. JSX {/* … */}
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments, sparing `https://`
    }

    function* walk(dir) {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) {
                yield* walk(full);
            } else if (/\.(js|jsx)$/.test(name)) {
                yield full;
            }
        }
    }

    it('finds the offending files, if any', () => {
        const offenders = [];
        for (const file of walk(SRC)) {
            const rel = relative(SRC, file).split(sep).join('/');
            if (ALLOWED.has(rel) || isTest(rel)) continue;
            const code = stripComments(readFileSync(file, 'utf8'));
            code.split('\n').forEach((line, i) => {
                if (ROUTE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            });
        }
        // Named in the failure, not merely counted: the fix is to route the
        // line through `planDetailPath(id)` / `planListPath(era)` with the
        // era of the data it read the id from, and a reader needs to see which
        // line to change.
        expect(offenders).toEqual([]);
    });

    it('would actually catch the #3381 regression', () => {
        // A self-check on the scanner. The line below is the exact shape of the
        // code that took production down — a plan route built by hand — and if
        // the regex or the comment stripper ever stopped matching it, the test
        // above would pass vacuously and this guard would be decoration.
        const regression = 'const open = (id) => navigate(`/swarm/pipeline/${id}`);';
        expect(ROUTE.test(stripComments(regression))).toBe(true);

        // And it must NOT fire on prose, or the first person to document a
        // route deletes the guard to get their commit through.
        expect(ROUTE.test(stripComments('// navigates to /swarm/pipeline/79'))).toBe(false);
        expect(ROUTE.test(stripComments('/* the /swarm/pipelines list */'))).toBe(false);
    });
});
