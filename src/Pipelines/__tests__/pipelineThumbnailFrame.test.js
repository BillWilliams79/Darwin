// req #3641 — the pipeline card thumbnail is an L3 CROP of the plan's middle,
// filling the card's width, not the whole plan shrunk to beads.
import { describe, it, expect } from 'vitest';

import { thumbnailFrame, THUMB_H, THUMB_EPICS_ACROSS } from '../pipelineThumbnailFrame';
import { adaptComposedPipeline } from '../../SwarmView/pipelines/pipelineAdapter';
import { computePlanLayout } from '../../SwarmView/pipelines/pipelinePlanLayout';
import { composedFixture } from '../../SwarmView/pipelines/__tests__/pipelineComposedFixture';

// A node the way `computePlanLayout` publishes one: centre x, box edges, height.
const node = (x, top, h, w = 375) => ({
    x, top, h, bottom: top + h, left: x - w / 2, right: x + w / 2,
});
const layoutOf = (nodes, { width = 4000, height = 2000, colPitch = 465 } = {}) => ({
    width, height, colPitch,
    nodes: new Map(nodes.map((n, i) => [i + 1, n])),
});

describe('thumbnailFrame', () => {
    it('spans THUMB_EPICS_ACROSS epic columns across the frame', () => {
        const f = thumbnailFrame(layoutOf([node(2000, 900, 200)]), 420);
        expect(f.k).toBeCloseTo(420 / (THUMB_EPICS_ACROSS * 465));
    });

    it('picks the crop that shows the most card, not the empty middle', () => {
        // A lone card sits nearest the world's centre; a cluster of three
        // neighbours sits off to the left. The cluster fills more of the frame.
        const layout = layoutOf([
            node(2000, 950, 100),
            node(600, 900, 120), node(1065, 900, 120), node(1530, 900, 120),
        ]);
        const f = thumbnailFrame(layout, 420);
        const shown = [600, 1065, 1530].filter((x) =>
            (x + 187.5) * f.k + f.ox > 0 && (x - 187.5) * f.k + f.ox < 420);
        expect(shown.length).toBeGreaterThanOrEqual(2);
    });

    it('breaks a tie toward the middle of the world', () => {
        // Three identical lone cards: equal coverage, so the middle one wins.
        const layout = layoutOf([node(500, 950, 100), node(2000, 950, 100),
            node(3500, 950, 100)]);
        const f = thumbnailFrame(layout, 420);
        expect(f.ox + 2000 * f.k).toBeCloseTo(210);
        expect(f.oy + 1000 * f.k).toBeCloseTo(THUMB_H / 2);
    });

    it('pins a card taller than the strip by its top so its name shows', () => {
        const layout = layoutOf([node(2000, 800, 1200)]);
        const f = thumbnailFrame(layout, 420);
        expect(f.oy + 800 * f.k).toBeCloseTo(8);
    });

    it('never runs the frame past the world edge where the world is bigger', () => {
        // The only card is at the far right edge: centring it would leave open
        // panel beyond the world, so the crop is clamped back.
        const layout = layoutOf([node(3900, 1000, 100)]);
        const f = thumbnailFrame(layout, 420);
        expect(f.ox).toBeCloseTo(420 - 4000 * f.k);
        expect(f.ox + 4000 * f.k).toBeCloseTo(420);
    });

    it('centres a world smaller than the frame on that axis', () => {
        const layout = layoutOf([node(500, 50, 100)], { width: 1000, height: 200 });
        const f = thumbnailFrame(layout, 420);
        // 200 world px tall at k ≈ 0.30 is ~60 px — inside the 132 px strip.
        expect(f.oy).toBeCloseTo((THUMB_H - 200 * f.k) / 2);
    });

    it('answers null when there is nothing to frame', () => {
        expect(thumbnailFrame(null, 420)).toBeNull();
        expect(thumbnailFrame(layoutOf([node(1, 1, 1)]), 0)).toBeNull();
        expect(thumbnailFrame(layoutOf([node(1, 1, 1)], { colPitch: 0 }), 420)).toBeNull();
    });

    // Against a REAL layout, so a change to `colPitch` or the node fields the
    // crop reads breaks here rather than in a blank thumbnail.
    it('frames a real computePlanLayout result with cards inside the frame', () => {
        const epics = [10, 11, 12, 13].map((id, i) => ({
            id, initiative_fk: 1, title: `Epic ${i}`, run: 'auto',
            notes: null, not_before: null,
        }));
        const data = composedFixture({
            id: 7,
            initiatives: [{ id: 1, pipeline_fk: 7, title: 'E', sort_order: 1 }],
            epics,
            requirements: [{ id: 501, title: 'R', requirement_status: 'met', tracking: 0 }],
            epicRequirements: [{ epic_fk: 10, requirement_fk: 501 }],
            epicDeps: [{ id: 1, epic_fk: 11, dep_epic_fk: 10 },
                { id: 2, epic_fk: 12, dep_epic_fk: 11 }, { id: 3, epic_fk: 13, dep_epic_fk: 12 }],
        });
        const plan = adaptComposedPipeline(data, { machines: [], now: new Date() });
        const layout = computePlanLayout(plan.rows, { epicLabel: 'title', reqLabel: 'title' });
        const f = thumbnailFrame(layout, 420);
        expect(f.k).toBeCloseTo(420 / (THUMB_EPICS_ACROSS * layout.colPitch));
        const inFrame = [...layout.nodes.values()].filter((n) =>
            n.right * f.k + f.ox > 0 && n.left * f.k + f.ox < 420
            && n.bottom * f.k + f.oy > 0 && n.top * f.k + f.oy < THUMB_H);
        expect(inFrame.length).toBeGreaterThanOrEqual(2);
    });
});
