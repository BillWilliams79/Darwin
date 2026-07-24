import { describe, it, expect } from 'vitest';
import {
    MODEL_EFFORT_COL_WIDTHS,
    modelEffortGridTemplate,
    baseGridTemplate,
} from '../modelEffortLayout';

// req #3029 — the Model/Effort columns override grid-template-columns inline, so
// the invariant that matters is: the injected template has exactly TWO more
// tracks than the base template, in the standard order. A miscount silently
// shoves Title/delete into the wrong column for every row in the card.
// req #3043 removed the display-mode/column-order options — this is now the
// only layout the module produces.

const tracks = (tpl) => tpl.split(/\s+/).filter(Boolean);

describe('modelEffortGridTemplate (req #3029 / #3043)', () => {
    it('defines a width for all four value columns', () => {
        for (const col of ['status', 'autonomy', 'model', 'effort']) {
            expect(MODEL_EFFORT_COL_WIDTHS[col]).toBeGreaterThan(0);
        }
    });

    it('adds exactly two tracks over the base template — category card', () => {
        const base = tracks(baseGridTemplate({ isAggregatorRow: false }));
        const withME = tracks(modelEffortGridTemplate({ isAggregatorRow: false }));
        expect(base.length).toBe(5);
        expect(withME.length).toBe(base.length + 2);
    });

    it('adds exactly two tracks over the base template — aggregator card', () => {
        const base = tracks(baseGridTemplate({ isAggregatorRow: true }));
        const withME = tracks(modelEffortGridTemplate({ isAggregatorRow: true }));
        expect(base.length).toBe(6);
        expect(withME.length).toBe(base.length + 2);
    });

    it('standard order: Req·Status·Autonomy·Model·Effort before Title (aggregator)', () => {
        // color-bar · Req# · Status(icon) · Autonomy(icon) · Model · Effort · Title(1fr) · delete(auto)
        // req #3046 — Status/Autonomy are 28px icon tracks, not pill tracks.
        const t = tracks(modelEffortGridTemplate({ isAggregatorRow: true }));
        expect(t).toEqual(['24px', '56px', '28px', '28px', '66px', '88px', '1fr', 'auto']);
    });

    it('standard order (category)', () => {
        const t = tracks(modelEffortGridTemplate({ isAggregatorRow: false }));
        expect(t).toEqual(['56px', '28px', '28px', '66px', '88px', '1fr', 'auto']);
    });
});
