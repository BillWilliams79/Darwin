// @vitest-environment jsdom
//
// Req #4158 — exact location and pointer: the point-resolver registry, what the
// pinned filer records and outlines over a canvas and over a large DOM
// container, the record(s) a page's address names (subject) with their
// database, and the two block lines that carry them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    hasPointResolver, isLargeElement, normalizeObject, objectLabel, registerPointResolver, resolveAt, specificUnder,
} from '../filerPointResolvers';
import { captureFiledFrom, pointedAtNow, registerPageOptions } from '../filedFromContext';
import { aimAt } from '../filerHover';
import { addressIds, databaseNote, resolveSubjects, subjectLabel, titleOf } from '../filerSubject';
import { pointedAtLabel, subjectLine, formatDebugBlock } from '../debugBundle';

// jsdom lays nothing out: each element's rect is given, and elementsFromPoint
// answers from those rects, topmost (last placed) first.
const rects = new Map();
const place = (el, x, y, w, h) => {
    rects.set(el, { x, y, w, h });
    el.getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y });
    return el;
};
beforeEach(() => {
    document.body.innerHTML = '';
    rects.clear();
    document.elementsFromPoint = (px, py) => [...rects.entries()]
        .filter(([, r]) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)
        .map(([el]) => el).reverse();
});
const filer = (x, y, w, h) => ({ id: 'requirement-filer', racked: false, rect: { x, y, w, h } });

/** A plan canvas host 1000×700 at the origin, with a canvas inside and one DOM chip over it. */
function planPage() {
    document.body.innerHTML = `
        <div data-testid="pipeline-plan-visualizer"><canvas></canvas>
          <span data-testid="pipeline-viz-initiative-pause-7">New initiative 3/4</span></div>`;
    const host = place(document.querySelector('[data-testid="pipeline-plan-visualizer"]'), 0, 0, 1000, 700);
    place(document.querySelector('canvas'), 0, 0, 1000, 700);
    place(document.querySelector('[data-testid^="pipeline-viz-initiative-pause"]'), 10, 10, 120, 20);
    return host;
}
// Epic 385 at (200..400, 100..200); requirement 4158 at (220..380, 150..170) inside it.
const planResolver = (x, y) => {
    if (x >= 220 && x <= 380 && y >= 150 && y <= 170) return { kind: 'requirement', id: 4158, title: 'Filer: exact location', rect: { left: 220, top: 150, width: 160, height: 20 } };
    if (x >= 200 && x <= 400 && y >= 100 && y <= 200) return { kind: 'epic', id: 385, title: 'Login Credentials', rect: { left: 200, top: 100, width: 200, height: 100 } };
    return null;
};

describe('the point-resolver registry (req #4158)', () => {
    it('registers per host testid; the latest answers; unregister restores the earlier', () => {
        const host = document.createElement('div');
        host.setAttribute('data-testid', 'canvas-host');
        expect(resolveAt(host, 1, 1)).toBeNull();
        const off1 = registerPointResolver('canvas-host', () => ({ kind: 'epic', id: 1 }));
        const off2 = registerPointResolver('canvas-host', () => ({ kind: 'epic', id: 2, title: '  Two   words ' }));
        expect(hasPointResolver('canvas-host')).toBe(true);
        expect(resolveAt(host, 1, 1)).toEqual({ kind: 'epic', id: 2, title: 'Two words', rect: null });
        off2();
        expect(resolveAt(host, 1, 1).id).toBe(1);
        off2(); // a second unregister is a no-op
        off1();
        expect(hasPointResolver('canvas-host')).toBe(false);
    });

    it('a resolver that throws or answers without kind/id answers nothing', () => {
        const host = document.createElement('div');
        host.setAttribute('data-testid', 'h2');
        const off = registerPointResolver('h2', () => { throw new Error('boom'); });
        expect(resolveAt(host, 0, 0)).toBeNull();
        off();
        expect(normalizeObject({ kind: 'epic' })).toBeNull();
        expect(normalizeObject({ id: 3 })).toBeNull();
        expect(normalizeObject({ kind: 'epic', id: 3, rect: { x: 1, y: 2, w: 3, h: 4 } }).rect).toEqual({ left: 1, top: 2, width: 3, height: 4 });
        // Scalar extras (a row's epic, an arc's ends) are kept; anything else is not.
        expect(normalizeObject({ kind: 'requirement', id: 7, epicId: 2, nested: { a: 1 }, fn: () => 1 }))
            .toEqual({ kind: 'requirement', id: 7, epicId: 2, rect: null });
    });

    it('labels an object by kind, #id and title', () => {
        expect(objectLabel({ kind: 'epic', id: 385, title: 'Login Credentials' })).toBe('epic #385 "Login Credentials"');
        expect(objectLabel({ kind: 'dependency', id: '12→15' })).toBe('dependency 12→15');
        expect(objectLabel({ kind: 'initiative', id: 'none', title: 'No initiative' })).toBe('initiative none "No initiative"');
    });
});

describe('ACCEPTANCE: a pinned filer over the plan canvas names the object, not the canvas', () => {
    let off;
    beforeEach(() => { off = registerPointResolver('pipeline-plan-visualizer', planResolver); });
    afterEach(() => off());

    it('pointedAt[0] carries the epic — its rect, its own label as text, the canvas as host', () => {
        planPage();
        // Centre (300, 120) over the epic; the corners off it, over bare canvas.
        const { pointedAt } = pointedAtNow(filer(230, 100, 140, 40));
        const [first] = pointedAt;
        expect(first.points).toContain('centre');
        expect(first.object).toEqual({ kind: 'epic', id: 385, title: 'Login Credentials' });
        expect(first.host).toBe('pipeline-plan-visualizer');
        expect(first.text).toBe('epic #385 "Login Credentials"');
        expect(first.rect).toEqual({ x: 200, y: 100, w: 200, h: 100 });
        expect(first.hostRect).toEqual({ x: 0, y: 0, w: 1000, h: 700 });
        expect(pointedAtLabel({ pointedAt }).path).toBe('epic #385 "Login Credentials" (pipeline-plan-visualizer)');
    });

    it('two objects under one filer are two records (a requirement row in its epic card)', () => {
        planPage();
        // Centre (300, 160) over the requirement row; top corners over the epic body.
        const { pointedAt } = pointedAtNow(filer(230, 104, 140, 112));
        expect(pointedAt[0].object).toMatchObject({ kind: 'requirement', id: 4158 });
        expect(pointedAt.map((p) => p.object?.kind)).toContain('epic');
    });

    it('a DOM chip over the canvas still names itself; bare canvas names the host', () => {
        planPage();
        const chip = pointedAtNow(filer(10, 5, 120, 30)).pointedAt[0];
        expect(chip.object).toBeUndefined();
        expect(chip.testidPath[0]).toBe('pipeline-viz-initiative-pause-7');
        const bare = pointedAtNow(filer(600, 500, 100, 40)).pointedAt[0];
        expect(bare.object).toBeUndefined();
        expect(bare.testidPath[0]).toBe('pipeline-plan-visualizer');
    });

    it('the outline (aimAt) shows the resolved object: its rect and its label', () => {
        planPage();
        const target = aimAt({ left: 230, top: 100, width: 140, height: 40 });
        expect(target.rect).toEqual({ left: 200, top: 100, width: 200, height: 100 });
        expect(target.name).toBe('epic #385 "Login Credentials" · pipeline-plan-visualizer');
        expect(target.key).toBe('object:pipeline-plan-visualizer:epic:385');
        // Moved onto the requirement: a different target on the same canvas.
        const row = aimAt({ left: 230, top: 140, width: 140, height: 40 });
        expect(row.key).toBe('object:pipeline-plan-visualizer:requirement:4158');
        expect(row.rect).toEqual({ left: 220, top: 150, width: 160, height: 20 });
    });

    it('unpinned, nothing is recorded (#3958 unchanged)', () => {
        planPage();
        const ctx = captureFiledFrom({
            location: { pathname: '/swarm/pipeline/12', search: '?mode=plan' }, database: 'darwin',
            popupId: 'requirement-filer', pinned: false, queryCache: { getAll: () => [] },
        });
        expect(ctx.pointedAt).toBeNull();
    });
});

describe('a large DOM container is descended to the specific child under the probe', () => {
    it('a grid row\'s data-id names the record, kind from the container', () => {
        document.body.innerHTML = `
            <div data-testid="initiatives-datagrid" data-filer-kind="initiative">
              <div role="row" data-id="12"><div role="gridcell"><span>Pre-WSL</span></div></div></div>`;
        const grid = place(document.querySelector('[data-testid]'), 0, 0, 1024, 700);
        place(document.querySelector('[role="row"]'), 0, 100, 1024, 40);
        place(document.querySelector('[role="gridcell"]'), 0, 100, 300, 40);
        const span = place(document.querySelector('span'), 10, 110, 80, 20);
        expect(isLargeElement(grid)).toBe(true);
        expect(specificUnder(span, grid)).toMatchObject({ kind: 'initiative', id: 12 });
        const [first] = pointedAtNow(filer(0, 100, 100, 40)).pointedAt;
        expect(first.object).toEqual({ kind: 'initiative', id: 12, title: 'Pre-WSL' });
        expect(first.within).toBe('initiatives-datagrid');
        expect(first.rect).toEqual({ x: 0, y: 100, w: 1024, h: 40 });
        expect(pointedAtLabel({ pointedAt: [first] }).path).toBe('initiative #12 "Pre-WSL" (initiatives-datagrid)');
    });

    it('without a data-id, the nearest identifiable element (aria-label, role, heading) is named in the container', () => {
        document.body.innerHTML = `
            <div data-testid="pipelines-page"><section><h2><span>Current Work</span></h2></section></div>`;
        place(document.querySelector('[data-testid]'), 0, 0, 1024, 768);
        place(document.querySelector('h2'), 20, 20, 300, 30);
        place(document.querySelector('span'), 20, 20, 150, 30);
        const [first] = pointedAtNow(filer(20, 15, 100, 40)).pointedAt;
        expect(first.specific).toMatchObject({ tag: 'h2', kind: 'h2' });
        expect(first.object).toBeUndefined();
        expect(first.text).toBe('Current Work');
        expect(pointedAtLabel({ pointedAt: [first] })).toMatchObject({ path: 'h2 in pipelines-page', text: 'Current Work' });
    });

    it('a small container is named as before', () => {
        document.body.innerHTML = '<div data-testid="small"><div role="row" data-id="1"><span>x</span></div></div>';
        const small = place(document.querySelector('[data-testid]'), 0, 0, 200, 100);
        const span = place(document.querySelector('span'), 0, 0, 20, 20);
        expect(specificUnder(span, small)).toBeNull();
    });
});

describe('the subject records, titled from the cache (req #4158)', () => {
    const cache = (entries) => ({ getAll: () => entries.map(([queryKey, data]) => ({ queryKey, state: { data } })) });
    const composed = {
        pipeline: { id: 12, title: 'Pre-WSL Integration Optimizations' },
        initiatives: [{ id: 7, title: 'Filer' }, { id: 8, title: 'Other' }],
        epics: [{ id: 492, title: 'Pointer', initiative_fk: 7 }, { id: 493, title: 'X', initiative_fk: 8 }],
        epic_requirements: [{ epic_fk: 492, requirement_fk: 4158 }, { epic_fk: 492, requirement_fk: 4160 }],
        requirements: [{ id: 4158, title: 'Filer: exact location and pointer' }],
    };

    it('names the route\'s record and the id-bearing query parameters, with size and database', () => {
        const subjects = resolveSubjects({
            routeIds: { pipeline: 12 }, query: { mode: 'plan', epic: '492' }, database: 'darwin',
            queryCache: cache([[['pipeline_compose', { id: 12 }], composed]]),
        });
        expect(subjects).toEqual([
            { kind: 'pipeline', id: 12, title: 'Pre-WSL Integration Optimizations', database: 'darwin', detail: '2 initiatives, 2 epics, 1 requirement' },
            { kind: 'epic', id: 492, title: 'Pointer', database: 'darwin', detail: '2 requirements, in pipeline 12' },
        ]);
        expect(subjectLabel(subjects[1])).toBe('epic 492 "Pointer" (2 requirements, in pipeline 12)');
    });

    it('reads a table\'s own query too; a record the page never read is named by id alone', () => {
        const subjects = resolveSubjects({
            routeIds: { requirement: 4158, session: 99 }, query: {}, database: 'darwin_dev',
            queryCache: cache([[['requirements', 'me', { id: 4158 }], [{ id: 4158, title: 'Filer: exact location and pointer' }]]]),
        });
        expect(subjects).toEqual([
            { kind: 'requirement', id: 4158, title: 'Filer: exact location and pointer', database: 'darwin_dev' },
            { kind: 'swarm session', id: 99, title: null, database: 'darwin_dev' },
        ]);
    });

    it('a page-reported subject joins them (the Topology view: no database)', () => {
        const subjects = resolveSubjects({ routeIds: {}, query: { opt: 'tpu8t' }, database: 'darwin', queryCache: null,
            pageSubjects: [{ kind: 'topology view', id: 'tpu8t', title: 'TPU v8t', database: null }] });
        expect(subjects).toEqual([{ kind: 'topology view', id: 'tpu8t', title: 'TPU v8t', database: null }]);
    });

    it('helpers: titleOf, addressIds, databaseNote', () => {
        expect(titleOf({ category_name: '  Swarm ' })).toBe('Swarm');
        expect(titleOf({ id: 1 })).toBeNull();
        expect(addressIds({ pipeline: 2 }, { epic: 'x', initiative: '3' })).toEqual([{ kind: 'pipeline', id: 2 }, { kind: 'initiative', id: 3 }]);
        expect(databaseNote('darwin')).toMatch(/production/);
        expect(databaseNote('darwin_dev')).toMatch(/as-is/);
        expect(databaseNote(null)).toBeNull();
    });

    it('captureFiledFrom stores them as filedFrom.subject and keeps state.database', () => {
        const ctx = captureFiledFrom({
            location: { pathname: '/swarm/pipeline/12', search: '?mode=plan&filer=1' }, database: 'darwin_dev',
            popupId: 'requirement-filer', queryCache: cache([[['pipeline_compose', { id: 12 }], composed]]),
        });
        expect(ctx.subject[0]).toMatchObject({ kind: 'pipeline', id: 12, title: 'Pre-WSL Integration Optimizations', database: 'darwin_dev' });
        expect(ctx.state.database).toBe('darwin_dev');
    });

    it('a registered page\'s surface and subject are used', () => {
        const off = registerPageOptions(() => ({ options: { level: 'in' }, surface: '/swarm/pipeline/12?mode=plan&level=3&filer=1',
            subject: [{ kind: 'topology view', id: 'v', title: 'V', database: null }] }));
        const ctx = captureFiledFrom({ location: { pathname: '/swarm/pipeline/12', search: '' }, database: 'darwin',
            popupId: 'requirement-filer', queryCache: null });
        off();
        expect(ctx.surface).toBe('/swarm/pipeline/12?mode=plan&level=3');
        expect(ctx.options.page).toEqual({ level: 'in' });
        expect(ctx.subject.map((s) => s.kind)).toEqual(['pipeline', 'topology view']);
    });
});

describe('the block\'s location and Pointed at lines (req #4158)', () => {
    it('Subject: names the records and which database their ids belong to', () => {
        const where = { state: { database: 'darwin' }, subject: [
            { kind: 'pipeline', id: 12, title: 'Pre-WSL', database: 'darwin', detail: '4 initiatives, 26 epics' },
            { kind: 'epic', id: 492, title: 'Pointer', database: 'darwin' }] };
        expect(subjectLine(where)).toBe('Subject: pipeline 12 "Pre-WSL" (4 initiatives, 26 epics) · epic 492 "Pointer"'
            + ' — production ids (darwin) — find or seed the match in darwin_dev');
        expect(subjectLine({ state: { database: 'darwin_dev' }, subject: [] })).toBe('Database: darwin_dev ids — they open as-is');
        expect(subjectLine({ state: { database: 'darwin' }, subject: [{ kind: 'topology view', id: 'v', title: 'V', database: null }] }))
            .toBe('Subject: topology view "v" "V" (not in a database)');
        expect(subjectLine(null)).toBeNull();
    });

    it('the block carries Surface, Subject and the object\'s Pointed at line', () => {
        const filedFrom = {
            surface: '/swarm/pipeline/12?mode=plan&level=3', url: { full: '/swarm/pipeline/12?mode=plan' },
            state: { database: 'darwin_dev' },
            subject: [{ kind: 'pipeline', id: 12, title: 'Plan', database: 'darwin_dev' }],
            pointedAt: [{ points: ['centre'], tag: 'div', testidPath: ['pipeline-plan-visualizer'], host: 'pipeline-plan-visualizer',
                object: { kind: 'epic', id: 385, title: 'Login Credentials' }, text: 'epic #385 "Login Credentials"', rect: { x: 1, y: 1, w: 1, h: 1 } }],
        };
        const capture = { version: 1, capturedAt: 'now', jwtHits: 0,
            categories: [{ key: 'filedFrom', label: 'Filed from', text: JSON.stringify(filedFrom), bytes: 1, note: '' }] };
        const block = formatDebugBlock(capture, [], 5000).split('\n');
        expect(block).toContain('Surface: /swarm/pipeline/12?mode=plan&level=3');
        expect(block).toContain('Subject: pipeline 12 "Plan" — darwin_dev ids — they open as-is');
        expect(block).toContain('Pointed at: epic #385 "Login Credentials" (pipeline-plan-visualizer)');
    });
});
