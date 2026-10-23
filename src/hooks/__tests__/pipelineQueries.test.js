// Req #3114 — Swarm Orchestration pipelines data layer: key shapes + hook
// exports. Mirrors the devopsQueriesParity / machinesQueries pattern for the
// plan-layer factory entities.
//
// req #3356 — THE PLAN LAYER IS ONE ERA. Migration 20260812175325 dropped the
// 1.0 tables and 20260812184333 renamed the 2.0 ones into the vacated names, so
// `pipelines` / `initiatives` / `epics` / the two junctions now MEAN what the
// `pipeline2_*` tables meant. Two consequences are asserted below rather than
// assumed, because both would fail as a 400 on a live read:
//   * `epic_deps` has NO `time_at` column — the time gate is
//     `epics.not_before`, a column on the EPIC, not a kind of dep row;
//   * `epics` carries `initiative_fk` and NOT `pipeline_fk` — an epic's plan
//     is reached through its initiative (containment).
// `initiatives` also moved: the hand-written `INITIATIVE_DEFAULT_FIELDS`/`useAllInitiatives`/
// `useInitiativeById` trio in useDataQueries.js was absorbed into a factory block, so
// the initiative projection is now `initiatives.config.defaultFields` and `useInitiativeById` no
// longer exists.
//
// Beyond shape, two things here are LOAD-BEARING and pinned deliberately:
//   * epics must sort id:asc — displayOrder()'s deterministic final
//     tie-break is the row's position in the input array, so "canonical stored
//     order" has to be requested, not hoped for;
//   * epic_requirements must never project an `id` column — it is a
//     keyed junction and has none.

import { describe, it, expect } from 'vitest';
import {
    pipelines,
    initiatives,
    pipelineEpics,
    pipelineEpicRequirements,
    pipelineEpicDeps,
} from '../factory/devopsQueries';
import {
    pipelineKeys,
    pipelineEpicKeys,
    pipelineEpicRequirementKeys,
    pipelineEpicDepKeys,
    initiativeKeys,
} from '../useQueryKeys';
import {
    useAllPipelines,
    useAllPipelineEpics,
    useAllPipelineEpicRequirements,
    useAllPipelineEpicDeps,
    useAllInitiatives,
    ALL_ROWS,
} from '../useDataQueries';

describe('pipeline key shapes', () => {
    it('pipelineKeys.all(creator) → ["pipelines", creator]', () => {
        expect(pipelineKeys.all('alice')).toEqual(['pipelines', 'alice']);
    });
    it('pipelineKeys.byId(creator, id) → ["pipelines", creator, { id }]', () => {
        expect(pipelineKeys.byId('alice', 7)).toEqual(['pipelines', 'alice', { id: 7 }]);
    });
    it('byId is prefix-compatible with all() for invalidation', () => {
        const allKey = pipelineKeys.all('alice');
        expect(pipelineKeys.byId('alice', 7).slice(0, allKey.length)).toEqual(allKey);
    });
    it('pipelineEpicKeys.all(creator) → ["epics", creator]', () => {
        expect(pipelineEpicKeys.all('alice')).toEqual(['epics', 'alice']);
    });
    it('pipelineEpicRequirementKeys.all(creator) → ["epic_requirements", creator]', () => {
        expect(pipelineEpicRequirementKeys.all('alice'))
            .toEqual(['epic_requirements', 'alice']);
    });
    it('pipelineEpicDepKeys.all(creator) → ["epic_deps", creator]', () => {
        expect(pipelineEpicDepKeys.all('alice')).toEqual(['epic_deps', 'alice']);
    });
});

describe('initiative key shapes', () => {
    it('all(creator) → ["initiatives", creator]', () => {
        expect(initiativeKeys.all('alice')).toEqual(['initiatives', 'alice']);
    });
    it('byId(creator, id) → ["initiatives", creator, { id }]', () => {
        expect(initiativeKeys.byId('alice', 4)).toEqual(['initiatives', 'alice', { id: 4 }]);
    });
    it('byId is prefix-compatible with all() for invalidation', () => {
        const allKey = initiativeKeys.all('alice');
        expect(initiativeKeys.byId('alice', 4).slice(0, allKey.length)).toEqual(allKey);
    });
});

describe('hook exports', () => {
    it('every pipeline hook is a function', () => {
        for (const hook of [useAllPipelines, useAllPipelineEpics,
            useAllPipelineEpicRequirements, useAllPipelineEpicDeps]) {
            expect(typeof hook).toBe('function');
        }
    });
    it('every initiative hook is a function', () => {
        // `useInitiativeById` is NOT asserted here any more: req #3356 deleted it with
        // the hand-written initiatives trio (it had no caller left once the 1.0 plan
        // surface went), and `useAllInitiatives` is now the factory block's `useAll`.
        expect(typeof useAllInitiatives).toBe('function');
    });
});

describe('projection + sort contracts', () => {
    it('epics is read in canonical stored order (id ascending)', () => {
        // Not cosmetic: pipelineModel.displayOrder() uses input-array position as
        // its final deterministic tie-break, so an unordered read could re-order
        // the plan between renders.
        expect(pipelineEpics.config.defaultSort).toBe('id:asc');
    });

    it('pipelines lists newest first', () => {
        expect(pipelines.config.defaultSort).toBe('id:desc');
    });

    it('epic_requirements never asks for an id column', () => {
        // Composite PK (epic_fk, requirement_fk) — the table has no id, and
        // requesting one makes Lambda-Rest 400 the whole read.
        expect(pipelineEpicRequirements.config.defaultFields).toBe('epic_fk,requirement_fk');
    });

    it('epic_deps projects the edge and nothing else — there is no time_at', () => {
        // INVERTED BY req #3356. The 1.0 dep table modelled a time gate as a
        // KIND OF DEP ROW (`time_at` set instead of `dep_epic_fk`), and this
        // asserted both columns came back. The surviving table has no `time_at`
        // at all — the time gate is `epics.not_before`, a column on the
        // EPIC — so requesting it would 400 the whole read.
        expect(pipelineEpicDeps.config.defaultFields).toBe('id,epic_fk,dep_epic_fk');
        expect(pipelineEpicDeps.config.defaultFields).not.toContain('time_at');
    });

    it('epics projects initiative_fk, not pipeline_fk (containment)', () => {
        // An epic belongs to an INITIATIVE and reaches its plan in two hops; there is
        // no `pipeline_fk` column on the epic to project. Naming one would 400
        // the read, and every consumer that walks epic -> initiative -> plan (the
        // requirement-detail Orchestration box, the plans list roll-up) depends
        // on `initiative_fk` actually arriving.
        const fields = pipelineEpics.config.defaultFields.split(',');
        expect(fields).toContain('initiative_fk');
        expect(fields).not.toContain('pipeline_fk');
    });

    it('epics projects no state and no seq column', () => {
        // Rules 1 and 3: neither exists in the schema. A projection naming one
        // would 400 the read AND signal that someone re-introduced stored state.
        expect(pipelineEpics.config.defaultFields).not.toMatch(/\bstate\b|\bstatus\b|\bseq\b|sort_order/);
    });

    it('epics projects no completed_at — an epic has no state (req #3750)', () => {
        // The column is DROPPED: naming it would 400 the whole read, which
        // empties every surface built on `useAllPipelineEpics`.
        expect(pipelineEpics.config.defaultFields.split(',')).not.toContain('completed_at');
    });

    it('pipeline reads carry no session columns', () => {
        // Design rule 9: requirement-centric views carry NO session data.
        const projections = [
            pipelines.config.defaultFields,
            pipelineEpics.config.defaultFields,
            pipelineEpicRequirements.config.defaultFields,
            pipelineEpicDeps.config.defaultFields,
        ].join(',');
        expect(projections).not.toMatch(/session/);
    });

    it('the initiative projection carries `sort_order` — the initiative display order (req #3430)', () => {
        // The browser reads initiatives through this ONE field list, and the plan
        // visualizer stacks its initiative bands by `initiatives.sort_order` (the
        // AUTHORITATIVE order, user ruling 2026-08-09). A column absent from an
        // explicit field list is INVISIBLE — req #2213's lesson, and precisely
        // how the server's composed read shipped `sort_order: None` for every
        // initiative while the value sat correct in the table. It was already here
        // when req #3430 made it load-bearing; what was missing is this line,
        // so nothing would have noticed it leaving.
        //
        // RE-POINTED, NOT WEAKENED, by req #3356: the hand-written
        // `INITIATIVE_DEFAULT_FIELDS` was absorbed into the `initiatives` factory block, so
        // the ONE field list the browser reads initiatives through is now
        // `initiatives.config.defaultFields` (frozen by createEntityQueries).
        const initiativeFields = initiatives.config.defaultFields.split(',');
        expect(initiativeFields).toContain('sort_order');
        // `initiative_status` (req #3223) is load-bearing in the same way — the pause
        // bubble reads it — and rides the same list.
        expect(initiativeFields).toContain('initiative_status');
    });

    it('every plan-layer block carries the fields-in-key collision guard', () => {
        // Req #2213 / #3015: without it, two callers with different projections
        // share one cache entry and the narrower fetch can win — silently, as a
        // blank column. It has to be in place BEFORE the second caller exists.
        //
        // `initiatives` joined this list at req #3356. That is the whole reason the
        // hand-written pair was folded in rather than left beside the factory
        // block: two readers of one entity with different projections, one of
        // them with no guard, is precisely the collision above.
        for (const block of [pipelines, initiatives, pipelineEpics,
            pipelineEpicRequirements, pipelineEpicDeps]) {
            expect(block.config.fieldsInKey).toBe(true);
        }
    });
});

describe('ALL_ROWS — the unfiltered-read sentinel', () => {
    it('survives the JSON.stringify a query-key hash performs', () => {
        // `undefined` does NOT: JSON.stringify drops undefined-valued properties,
        // so { fields, closed: undefined } and { fields } hash IDENTICALLY and two
        // reads with different URLs would silently share one cache entry. This is
        // the whole reason the sentinel is a string.
        expect(JSON.stringify({ fields: 'f', closed: ALL_ROWS }))
            .not.toBe(JSON.stringify({ fields: 'f' }));
        expect(JSON.stringify({ fields: 'f', closed: undefined }))
            .toBe(JSON.stringify({ fields: 'f' }));
    });

    it('is distinguishable from the closed=0 default', () => {
        expect(JSON.stringify({ closed: ALL_ROWS })).not.toBe(JSON.stringify({ closed: 0 }));
    });
});
