import { describe, it, expect } from 'vitest';
import {
    MODEL_EFFORT_COL_WIDTHS,
    modelEffortGridTemplate,
    baseGridTemplate,
} from '../modelEffortLayout';
import {
    MODEL_EFFORT_DISPLAY_MODES,
    MODEL_EFFORT_COLUMN_ORDERS,
} from '../../stores/useModelEffortDisplayStore';

// req #3029 — the Model/Effort columns override grid-template-columns inline, so
// the invariant that matters is: the injected template has exactly TWO more
// tracks than the base template, in the order chosen by columnOrder. A miscount
// silently shoves Title/delete into the wrong column for every row in the card.

const tracks = (tpl) => tpl.split(/\s+/).filter(Boolean);

describe('modelEffortGridTemplate (req #3029)', () => {
    it('defines a width for all four mode columns in every supported display mode', () => {
        for (const mode of MODEL_EFFORT_DISPLAY_MODES) {
            expect(MODEL_EFFORT_COL_WIDTHS[mode]).toBeTruthy();
            for (const col of ['status', 'autonomy', 'model', 'effort']) {
                expect(MODEL_EFFORT_COL_WIDTHS[mode][col]).toBeGreaterThan(0);
            }
        }
    });

    it('supports exactly pill + compact display modes', () => {
        expect(Object.keys(MODEL_EFFORT_COL_WIDTHS).sort()).toEqual(['compact', 'pill']);
    });

    it('keeps Status/Autonomy at the icon width (28px) in compact mode', () => {
        expect(MODEL_EFFORT_COL_WIDTHS.compact.status).toBe(28);
        expect(MODEL_EFFORT_COL_WIDTHS.compact.autonomy).toBe(28);
    });

    it('adds exactly two tracks over the base template — category card', () => {
        const base = tracks(baseGridTemplate({ isAggregatorRow: false }));
        const withME = tracks(modelEffortGridTemplate({ isAggregatorRow: false, displayMode: 'pill', columnOrder: 'standard' }));
        expect(base.length).toBe(5);
        expect(withME.length).toBe(base.length + 2);
    });

    it('adds exactly two tracks over the base template — aggregator card', () => {
        const base = tracks(baseGridTemplate({ isAggregatorRow: true }));
        const withME = tracks(modelEffortGridTemplate({ isAggregatorRow: true, displayMode: 'pill', columnOrder: 'standard' }));
        expect(base.length).toBe(6);
        expect(withME.length).toBe(base.length + 2);
    });

    it('standard order: Req·Status·Autonomy·Model·Effort before Title (aggregator, pill)', () => {
        // color-bar · Req# · Status · Autonomy · Model · Effort · Title(1fr) · delete(auto)
        const t = tracks(modelEffortGridTemplate({ isAggregatorRow: true, displayMode: 'pill', columnOrder: 'standard' }));
        expect(t).toEqual(['24px', '56px', '116px', '112px', '66px', '88px', '1fr', 'auto']);
    });

    it('standard order (category, pill)', () => {
        const t = tracks(modelEffortGridTemplate({ isAggregatorRow: false, displayMode: 'pill', columnOrder: 'standard' }));
        expect(t).toEqual(['56px', '116px', '112px', '66px', '88px', '1fr', 'auto']);
    });

    it('meFirst order leads with Model·Effort, keeping color-bar first (aggregator)', () => {
        // color-bar · Model · Effort · Req# · Status · Autonomy · Title · delete
        const t = tracks(modelEffortGridTemplate({ isAggregatorRow: true, displayMode: 'pill', columnOrder: 'meFirst' }));
        expect(t).toEqual(['24px', '66px', '88px', '56px', '116px', '112px', '1fr', 'auto']);
    });

    it('meAfterReq order places Model·Effort between Req# and Status (aggregator)', () => {
        // color-bar · Req# · Model · Effort · Status · Autonomy · Title · delete
        const t = tracks(modelEffortGridTemplate({ isAggregatorRow: true, displayMode: 'pill', columnOrder: 'meAfterReq' }));
        expect(t).toEqual(['24px', '56px', '66px', '88px', '116px', '112px', '1fr', 'auto']);
    });

    it('meAfterReq order (category)', () => {
        // Req# · Model · Effort · Status · Autonomy · Title · delete
        const t = tracks(modelEffortGridTemplate({ isAggregatorRow: false, displayMode: 'pill', columnOrder: 'meAfterReq' }));
        expect(t).toEqual(['56px', '66px', '88px', '116px', '112px', '1fr', 'auto']);
    });

    it('collapses to icon/letter widths in compact mode (matches today for Status/Autonomy)', () => {
        const t = tracks(modelEffortGridTemplate({ isAggregatorRow: false, displayMode: 'compact', columnOrder: 'standard' }));
        expect(t).toEqual(['56px', '28px', '28px', '30px', '30px', '1fr', 'auto']);
    });

    it('falls back to pill widths for an unknown mode', () => {
        const unknown = modelEffortGridTemplate({ isAggregatorRow: false, displayMode: 'nope', columnOrder: 'standard' });
        const pill = modelEffortGridTemplate({ isAggregatorRow: false, displayMode: 'pill', columnOrder: 'standard' });
        expect(unknown).toBe(pill);
    });

    it('every column order still adds exactly two tracks over base', () => {
        const base = tracks(baseGridTemplate({ isAggregatorRow: true }));
        for (const columnOrder of MODEL_EFFORT_COLUMN_ORDERS) {
            const withME = tracks(modelEffortGridTemplate({ isAggregatorRow: true, displayMode: 'compact', columnOrder }));
            expect(withME.length).toBe(base.length + 2);
        }
    });
});
