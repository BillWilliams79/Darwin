// Req #4158 — what the plan canvas draws at a point (the Requirement Filer's
// pushpin), tested against the REAL layout the canvas draws, and what the page
// reports to the filer as its surface and options.

import { describe, it, expect } from 'vitest';

import { BEAD_HIT_RADIUS, computePlanLayout, drawsLabelKind } from '../pipelinePlanLayout';
import { ARC_HIT_PX, pathPoints, planObjectAt } from '../planPointObject';
import { planFilerSurface } from '../planFilerSurface';

const mkRow = (id, depIds = [], initiativeId = 5, initiative = 'Filer work') => ({
    id, title: `epic ${id}`, run: 'auto', state: 'pending', reqIds: [id * 100, id * 100 + 1],
    depIds, timeDeps: [], initiativeId, initiative, initiativeLabels: [],
    featureLabels: [], machineLabels: [], machineLabel: '—',
});
const rows = [mkRow(1), mkRow(2, [1]), mkRow(3, [], 6, 'Other initiative')];
const layout = computePlanLayout(rows, {});
const titles = new Map(rows.map((r) => [r.id, r.title]));
const opts = (level) => ({
    level, drawsKind: (k) => drawsLabelKind(k, level), drawsCard: drawsLabelKind('epic', level),
    beadHitRadius: BEAD_HIT_RADIUS, epicTitle: (id) => titles.get(id) ?? null,
    reqTitle: (id) => `Requirement ${id}`,
});
const t = { x: 40, y: 30, k: 1.5 };
const toPanel = (wx, wy) => ({ x: wx * t.k + t.x, y: wy * t.k + t.y });

describe('planObjectAt (req #4158)', () => {
    it('ACCEPTANCE: a point on an epic card names that epic, with the card\'s screen rect', () => {
        const n = layout.nodes.get(2);
        const o = planObjectAt(layout, t, toPanel(n.frameLeft + 4, n.top + 4), opts('in'));
        expect(o).toMatchObject({ kind: 'epic', id: 2, title: 'epic 2' });
        expect(o.rect).toEqual({ left: n.frameLeft * t.k + t.x, top: n.top * t.k + t.y, width: n.frameW * t.k, height: n.h * t.k });
    });

    it('ACCEPTANCE: a point on a requirement row names the requirement, not its card', () => {
        const row = layout.labels.find((l) => l.kind === 'req' && l.epicId === 1);
        expect(row).toBeTruthy();
        const o = planObjectAt(layout, t, toPanel(row.x + 1, row.y + 1), opts('in'));
        expect(o).toMatchObject({ kind: 'requirement', id: row.reqId, title: `Requirement ${row.reqId}`, epicId: 1 });
        expect(o.rect.width).toBeCloseTo(row.w * t.k);
    });

    it('at L2 a row is where its bare id is DRAWN (idY), not its L3 title box (review finding)', () => {
        const long = 'a very long requirement title that will certainly wrap onto several lines in the card because it is long long long long long long';
        const titled = computePlanLayout([{ ...mkRow(1), reqIds: [100, 101, 102] }], {
            reqLabel: 'title', reqTitles: new Map([[100, long], [101, 'short'], [102, 'short']]),
        });
        const r101 = titled.labels.find((l) => l.kind === 'req' && l.reqId === 101);
        expect(r101.idY).not.toBe(r101.y);
        const at = (wy, level) => planObjectAt(titled, t, toPanel(r101.x + 2, wy + 2), { ...opts(level), reqTitle: String });
        expect(at(r101.idY, 'mid')).toMatchObject({ kind: 'requirement', id: 101 });
        expect(at(r101.idY, 'mid').rect.top).toBeCloseTo(r101.idY * t.k + t.y);
        // At L3 the same requirement is at its title box.
        expect(at(r101.y, 'in')).toMatchObject({ kind: 'requirement', id: 101 });
    });

    it('ACCEPTANCE: a point in a band, off every card, names the initiative band', () => {
        const band = layout.bands.find((b) => b.initiativeId === 6);
        const o = planObjectAt(layout, t, toPanel(2, band.y + 2), opts('in'));
        expect(o).toMatchObject({ kind: 'initiative', id: 6, title: 'Other initiative' });
        expect(o.rect.top).toBeCloseTo(band.y * t.k + t.y);
    });

    it('a point on a dependency arc names both epics and the direction', () => {
        const arc = layout.arcs.find((a) => a.fromId === 1 && a.toId === 2);
        expect(arc).toBeTruthy();
        const pts = arc.path ? pathPoints(arc.path) : [[arc.x1, arc.y1], [arc.x2, arc.y2]];
        const mid = pts[Math.floor(pts.length / 2)];
        const [mx, my] = arc.path ? mid : [(arc.x1 + arc.x2) / 2, (arc.y1 + arc.y2) / 2];
        const o = planObjectAt(layout, t, toPanel(mx, my + (ARC_HIT_PX - 1) / t.k), opts('in'));
        expect(o).toMatchObject({ kind: 'dependency', id: '1→2', title: 'epic #2 "epic 2" waits for epic #1 "epic 1"' });
    });

    it('at Overview the bead is the epic; requirement rows are not drawn, so not named', () => {
        const n = layout.nodes.get(1);
        const o = planObjectAt(layout, t, toPanel(n.x, n.y), opts('out'));
        expect(o).toMatchObject({ kind: 'epic', id: 1 });
        const row = layout.labels.find((l) => l.kind === 'req' && l.epicId === 3);
        const far = planObjectAt(layout, t, toPanel(row.x + 1, row.y + 1), opts('out'));
        expect(far?.kind).not.toBe('requirement');
    });

    it('off the plan, or without a camera, it names nothing', () => {
        expect(planObjectAt(layout, t, toPanel(-50, -50), opts('in'))).toBeNull();
        expect(planObjectAt(layout, null, { x: 1, y: 1 }, opts('in'))).toBeNull();
        expect(planObjectAt(null, t, { x: 1, y: 1 }, opts('in'))).toBeNull();
    });

    it('pathPoints samples an arc path: M, C and L', () => {
        const pts = pathPoints('M0,0 C10,0 10,10 20,10 L30,10', 4);
        expect(pts[0]).toEqual([0, 0]);
        expect(pts[4]).toEqual([20, 10]);
        expect(pts[pts.length - 1]).toEqual([30, 10]);
    });
});

describe('planFilerSurface (req #4158)', () => {
    const view = {
        level: 'mid', levelPref: 'auto', colorKey: 'state', palette: 'aurora', pipeline: { id: 12 },
        t: { x: 10.123, y: 20.456, k: 1.23456 },
        collapsed: { initiativeIds: new Set([null, 7]), epicIds: new Set([3]) },
        hiddenMachines: new Set([2]), focusEpicId: null, focusInitiativeId: 9, reqEdit: { reqId: 4158 },
    };

    it('the surface reopens the drawn level, colour key and the open editor\'s element; other params kept', () => {
        const { surface, options } = planFilerSurface(view, {
            pathname: '/swarm/pipeline/12', search: '?mode=plan&level=1&filer=1&engineMachine=2',
            editor: { kind: 'epic', id: 385 },
        });
        expect(surface).toBe('/swarm/pipeline/12?mode=plan&level=2&color=state&epic=385&engineMachine=2');
        expect(options).toMatchObject({
            view: 'plan', pipelineId: 12, level: 'mid', levelNumber: 2, levelPref: 'auto', colorKey: 'state',
            selected: { editor: { kind: 'epic', id: 385 }, requirementTitleEdit: 4158 },
            collapsed: { initiatives: ['none', 7], epics: [3] },
            camera: { x: 10.1, y: 20.5, k: 1.2346 }, hiddenMachines: [2],
        });
    });

    it('the open editors are subjects, titled from the canvas; a malformed escape keeps the surface', () => {
        const v = { ...view, rowById: new Map([[385, { title: 'Login Credentials' }]]), reqTitles: new Map([[4158, 'Filer']]) };
        const out = planFilerSurface(v, { pathname: '/swarm/pipeline/12', search: '?q=100%&mode=plan',
            editor: { kind: 'epic', id: 385 }, requirementEditor: 4158 });
        expect(out.subject).toEqual([{ kind: 'epic', id: 385, title: 'Login Credentials' }]);
        expect(out.options.selected.requirementEditor).toBe(4158);
        expect(out.surface).toBe('/swarm/pipeline/12?mode=plan&level=2&color=state&epic=385&q=100%');
    });

    it('with no editor open, the link\'s focus is the selection', () => {
        expect(planFilerSurface(view, { pathname: '/swarm/pipeline/12', search: '' }).surface)
            .toBe('/swarm/pipeline/12?mode=plan&level=2&color=state&initiative=9');
    });
});
