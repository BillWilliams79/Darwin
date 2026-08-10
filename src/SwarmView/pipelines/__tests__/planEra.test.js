// planEra.test.js — the era↔route↔entity binding, and THE GUARD (req #3463).
//
// The second `describe` in this file is the mechanical reason req #3462's class
// of outage cannot recur. It is not a unit test of a function: it reads the
// whole of `src/` off disk and fails if any file other than `planEra.js` spells
// a plan route as a string. Everything else here is ordinary coverage of the
// module that test forces everyone through.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEFAULT_PLAN_ERA,
    PLAN_ERAS,
    PLAN_ERA_1,
    PLAN_ERA_2,
    isPlanEra,
    normalizePlanId,
    planDetailPath,
    planDetailPathPattern,
    planDetailRoutePath,
    planEntityName,
    planEraBinding,
    planEraLabel,
    planEraOfSession,
    planListPath,
    planListRoutePath,
    planStorageNamespace,
} from '../planEra';

describe('the binding', () => {
    it('binds each era to its own route, entity and storage namespace', () => {
        expect(planListPath(PLAN_ERA_1)).toBe('/swarm/pipelines');
        expect(planDetailPath(PLAN_ERA_1, 79)).toBe('/swarm/pipeline/79');
        expect(planEntityName(PLAN_ERA_1)).toBe('pipelines');
        expect(planStorageNamespace(PLAN_ERA_1)).toBe('pipeline-plan');

        expect(planListPath(PLAN_ERA_2)).toBe('/swarm/pipelines2');
        expect(planDetailPath(PLAN_ERA_2, 7)).toBe('/swarm/pipeline2/7');
        expect(planEntityName(PLAN_ERA_2)).toBe('pipeline2_pipelines');
        expect(planStorageNamespace(PLAN_ERA_2)).toBe('pipeline2-plan');
    });

    it('NEVER produces the same route for two eras — the whole point', () => {
        // THE OUTAGE, AS AN ASSERTION (req #3462). Production `pipelines` held
        // {2, 79, 80} and `pipeline2_pipelines` held {7}. The defect was that one
        // route answered for both id spaces, so an id from either could be
        // handed to it. Here, the SAME id produces two different addresses and
        // the reader of either always knows which table answers.
        for (const id of [2, 7, 79, 80]) {
            expect(planDetailPath(PLAN_ERA_1, id))
                .not.toBe(planDetailPath(PLAN_ERA_2, id));
        }
    });

    it('defaults to 1.0 so an omitted era reproduces the pre-#3463 app', () => {
        expect(DEFAULT_PLAN_ERA).toBe(PLAN_ERA_1);
        expect(planListPath()).toBe(planListPath(PLAN_ERA_1));
        expect(planDetailPath(undefined, 2)).toBe('/swarm/pipeline/2');
        expect(planStorageNamespace()).toBe('pipeline-plan');
    });

    it('THROWS on an unknown era rather than falling back', () => {
        // A silent fallback is exactly the #3462 failure mode: something asks
        // for an era that does not exist and gets one era's route pointed at
        // another era's data. Loud is the only safe answer, and it is only
        // reachable from code that is wrong.
        for (const bad of [0, 3, '1', '2', null, {}, NaN]) {
            expect(() => planEraBinding(bad)).toThrow(/unknown plan era/);
        }
        // `undefined` alone means "omitted" and takes the default.
        expect(() => planEraBinding(undefined)).not.toThrow();
    });

    it('isPlanEra admits exactly the two eras, as NUMBERS', () => {
        expect(PLAN_ERAS).toEqual([PLAN_ERA_1, PLAN_ERA_2]);
        expect(isPlanEra(1)).toBe(true);
        expect(isPlanEra(2)).toBe(true);
        // A stored/serialized era arrives as a string from web storage and from
        // router state. Admitting it would defeat every `=== PAGE_ERA` compare
        // downstream, so it is refused here and the record is dropped.
        for (const bad of ['1', '2', 0, 3, null, undefined, true, [1]]) {
            expect(isPlanEra(bad)).toBe(false);
        }
    });

    it('labels each era for a reader without ever labelling a decision', () => {
        expect(planEraLabel(PLAN_ERA_1)).toBe('1.0');
        expect(planEraLabel(PLAN_ERA_2)).toBe('2.0');
    });
});

describe('planDetailPath — id handling', () => {
    it('returns null rather than a dead link for an unusable id', () => {
        // `Number(null)` and `Number('')` are both 0, and 0 is a perfectly good
        // integer — a plan id that never resolved would otherwise produce a
        // confident link to plan 0, rendering the not-found alert as though the
        // DATA were at fault.
        for (const bad of [null, undefined, '', 'abc', '12abc', 1.5, NaN, {}, []]) {
            expect(planDetailPath(PLAN_ERA_1, bad)).toBeNull();
            expect(planDetailPath(PLAN_ERA_2, bad)).toBeNull();
        }
    });

    it('accepts 0 and a numeric string, because both are real ids', () => {
        expect(planDetailPath(PLAN_ERA_1, 0)).toBe('/swarm/pipeline/0');
        expect(planDetailPath(PLAN_ERA_1, '79')).toBe('/swarm/pipeline/79');
    });

    it('appends a query string only when one is given', () => {
        expect(planDetailPath(PLAN_ERA_1, 2, 'mode=table&step=9'))
            .toBe('/swarm/pipeline/2?mode=table&step=9');
        expect(planDetailPath(PLAN_ERA_1, 2, null)).toBe('/swarm/pipeline/2');
        expect(planDetailPath(PLAN_ERA_1, 2, '')).toBe('/swarm/pipeline/2');
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
    it('matches its own era and not the other', () => {
        expect(planDetailPathPattern(PLAN_ERA_1).test('/swarm/pipeline/2')).toBe(true);
        expect(planDetailPathPattern(PLAN_ERA_1).test('/swarm/pipeline2/2')).toBe(false);
        expect(planDetailPathPattern(PLAN_ERA_2).test('/swarm/pipeline2/7')).toBe(true);
        expect(planDetailPathPattern(PLAN_ERA_2).test('/swarm/pipeline/7')).toBe(false);
    });

    it('never matches a LIST path — they differ by one character', () => {
        expect(planDetailPathPattern(PLAN_ERA_1).test('/swarm/pipelines')).toBe(false);
        expect(planDetailPathPattern(PLAN_ERA_2).test('/swarm/pipelines2')).toBe(false);
    });

    it('requires a digits-only id segment and nothing after it', () => {
        const re = planDetailPathPattern(PLAN_ERA_1);
        expect(re.test('/swarm/pipeline/2/')).toBe(true);
        expect(re.test('/swarm/pipeline/2/anything')).toBe(false);
        expect(re.test('/swarm/pipeline/abc')).toBe(false);
        expect(re.test('/x/swarm/pipeline/2')).toBe(false);
    });

    it('agrees with the builder — derived from one literal, not two', () => {
        for (const era of PLAN_ERAS) {
            expect(planDetailPathPattern(era).test(planDetailPath(era, 42))).toBe(true);
        }
    });
});

describe('planEraOfSession — the COLUMN names the era', () => {
    it('reads a 1.0 seat off pipeline_fk', () => {
        expect(planEraOfSession({ pipeline_fk: 79, pipeline2_fk: null }))
            .toEqual({ era: PLAN_ERA_1, pipelineId: 79, epicId: null });
    });

    it('reads a 2.0 seat off pipeline2_fk', () => {
        expect(planEraOfSession({ pipeline_fk: null, pipeline2_fk: 7 }))
            .toEqual({ era: PLAN_ERA_2, pipelineId: 7, epicId: null });
    });

    // The EPIC is the same column pair one level down (code review). A caller
    // that took the pipeline from here and then read `row.epic_fk` itself would
    // be era-correct about the plan and era-blind about the epic — half a fix.
    it('reads the EPIC from the matching era, never the other one', () => {
        expect(planEraOfSession({ pipeline_fk: 79, epic_fk: 4, epic2_fk: 99 }))
            .toEqual({ era: PLAN_ERA_1, pipelineId: 79, epicId: 4 });
        expect(planEraOfSession({ pipeline2_fk: 7, epic2_fk: 9, epic_fk: 99 }))
            .toEqual({ era: PLAN_ERA_2, pipelineId: 7, epicId: 9 });
    });

    it('reports a NULL epic as null — work on a plan but under no epic', () => {
        expect(planEraOfSession({ pipeline_fk: 79, epic_fk: null }).epicId).toBeNull();
        expect(planEraOfSession({ pipeline2_fk: 7, epic2_fk: null }).epicId).toBeNull();
    });

    it('returns null for work outside any plan — a REAL answer, not an error', () => {
        expect(planEraOfSession({ pipeline_fk: null, pipeline2_fk: null })).toBeNull();
        expect(planEraOfSession({})).toBeNull();
        expect(planEraOfSession(null)).toBeNull();
    });

    it('attributes a row carrying BOTH to 2.0, surfacing the data defect', () => {
        // A row with both columns set is not legal (the two are exclusive). 2.0
        // is tested first so the newer era wins, which surfaces the defect
        // rather than hiding it under the era being retired — the same order
        // `scopeLabel` uses in orchestrationHolder.js.
        expect(planEraOfSession({ pipeline_fk: 79, pipeline2_fk: 7 }).era).toBe(PLAN_ERA_2);
    });

    it('does not mistake an unusable id for a seat', () => {
        expect(planEraOfSession({ pipeline_fk: '', pipeline2_fk: null })).toBeNull();
        expect(planEraOfSession({ pipeline_fk: 'x', pipeline2_fk: null })).toBeNull();
    });
});

describe('route declarations', () => {
    it('gives index.jsx the same routes the builders emit', () => {
        // A matcher and a builder that state the route separately are how a
        // rename breaks the guard while the link keeps working. `index.jsx`
        // declares from these, so there is one literal per route in the app.
        expect(planListRoutePath(PLAN_ERA_1)).toBe('swarm/pipelines');
        expect(planDetailRoutePath(PLAN_ERA_1)).toBe('swarm/pipeline/:id');
        expect(planListRoutePath(PLAN_ERA_2)).toBe('swarm/pipelines2');
        expect(planDetailRoutePath(PLAN_ERA_2)).toBe('swarm/pipeline2/:id');
    });

    it('route paths are the link paths without the leading slash', () => {
        for (const era of PLAN_ERAS) {
            expect(`/${planListRoutePath(era)}`).toBe(planListPath(era));
            expect(`/${planDetailRoutePath(era)}`)
                .toBe(planDetailPath(era, 0).replace('/0', '/:id'));
        }
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
        // line through `planDetailPath(era, id)` / `planListPath(era)` with the
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
