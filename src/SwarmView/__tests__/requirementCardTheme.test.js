// @vitest-environment jsdom
//
// Req #3644 — the Requirements page wears the plan's look: its colour key
// resolves through the plan's own scale registry over the plan's DEFAULT
// palette (aurora — the one the canvas draws), never a copy of it.

import { describe, it, expect, beforeEach } from 'vitest';

import {
    requirementColorViews, requirementKeyColor, requirementKeyLegend,
    requirementSpecSummary, categoryBrandColor, NEUTRAL_OUTLINE, REQ_CARD_THEME,
    cardFrameSx, CARD_FRAME_STROKE,
} from '../requirementCardTheme';
import { CARD_RADIUS } from '../pipelines/pipelinePlanLayout';
import {
    planPalette, DEFAULT_PLAN_PALETTE, PLAN_VIZ_PALETTE, REQ_STATUS_ORDER, AUTONOMY_ORDER,
} from '../pipelines/pipelinePlanLayout';
import { REQUIREMENT_COLOR_SCALES } from '../requirementCardTheme';
import { AI_MODEL_COLOR, AI_MODELS } from '../modelChipStyles';
import { EFFORT_COLOR, EFFORTS } from '../effortChipStyles';
import { useRequirementColorKeyStore } from '../../stores/useRequirementColorKeyStore';

const AURORA = planPalette(DEFAULT_PLAN_PALETTE);
const rows = [
    { id: 1, requirement_status: 'met', coordination_type: 'deployed', ai_model: 'sonnet', effort: 'xhigh' },
    { id: 2, requirement_status: 'authoring', coordination_type: 'discuss', ai_model: null, effort: '' },
    { id: '', title: '' }, // the template row is ignored
];

describe('requirementKeyColor', () => {
    const views = requirementColorViews({ requirements: rows, sessionStatusMap: { 1: 'active' } });

    it('State reads the aurora status palette', () => {
        expect(requirementKeyColor({ colorKey: 'state', views, reqId: 1 }))
            .toEqual({ color: AURORA.status.met, keyed: true });
        expect(requirementKeyColor({ colorKey: 'state', views, reqId: 2 }).color)
            .toBe(AURORA.status.authoring);
    });

    it('Session attaches the session map, no_session when absent', () => {
        expect(requirementKeyColor({ colorKey: 'session', views, reqId: 1 }).color)
            .toBe(AURORA.session.active);
        expect(requirementKeyColor({ colorKey: 'session', views, reqId: 2 }).color)
            .toBe(AURORA.session.no_session);
    });

    it('Autonomy reads the plan scale', () => {
        expect(requirementKeyColor({ colorKey: 'autonomy', views, reqId: 2 }).color)
            .toBe(AURORA.autonomy.discuss);
    });

    it('Model and Effort read the original columns\' colours, blanks as opus / high', () => {
        expect(requirementKeyColor({ colorKey: 'model', views, reqId: 1 }).color).toBe(AI_MODEL_COLOR.sonnet);
        expect(requirementKeyColor({ colorKey: 'model', views, reqId: 2 }).color).toBe(AI_MODEL_COLOR.opus);
        expect(requirementKeyColor({ colorKey: 'effort', views, reqId: 1 }).color).toBe(EFFORT_COLOR.xhigh);
        expect(requirementKeyColor({ colorKey: 'effort', views, reqId: 2 }).color).toBe(EFFORT_COLOR.high);
    });

    it('offers exactly the original row\'s display elements, in order', () => {
        expect(REQUIREMENT_COLOR_SCALES.map((sc) => sc.key))
            .toEqual(['state', 'session', 'autonomy', 'model', 'effort']);
    });

    it("'none', the template row, a hostile key and the retired 'machine' normalize", () => {
        expect(requirementKeyColor({ colorKey: 'none', views, reqId: 1 }))
            .toEqual({ color: NEUTRAL_OUTLINE, keyed: false });
        expect(requirementKeyColor({ colorKey: 'state', views, reqId: '' }).keyed).toBe(false);
        // An unknown key normalizes to the default (State), as the plan does.
        expect(requirementKeyColor({ colorKey: 'constructor', views, reqId: 1 }).color)
            .toBe(AURORA.status.met);
        expect(requirementKeyColor({ colorKey: 'machine', views, reqId: 1 }).color)
            .toBe(AURORA.status.met);
    });
});

describe('requirementKeyLegend', () => {
    it('lists every value of the active scale in its own order', () => {
        const views = requirementColorViews({});
        expect(requirementKeyLegend({ colorKey: 'state', views }).entries.map((e) => e.key))
            .toEqual(REQ_STATUS_ORDER);
        expect(requirementKeyLegend({ colorKey: 'autonomy', views }).entries.map((e) => e.key))
            .toEqual(AUTONOMY_ORDER);
        expect(requirementKeyLegend({ colorKey: 'state', views }).title).toBe('status');
        expect(requirementKeyLegend({ colorKey: 'model', views }).entries.map((e) => e.key))
            .toEqual(AI_MODELS);
        expect(requirementKeyLegend({ colorKey: 'effort', views }).entries.map((e) => e.key))
            .toEqual(EFFORTS);
    });

    it('is null when no scale is on', () => {
        expect(requirementKeyLegend({ colorKey: 'none', views: {} })).toBeNull();
    });
});

describe('card tokens and helpers', () => {
    it('are the plan palette', () => {
        expect(REQ_CARD_THEME.panel).toBe(PLAN_VIZ_PALETTE.panel);
        expect(REQ_CARD_THEME.field).toBe(PLAN_VIZ_PALETTE.bg);
        expect(REQ_CARD_THEME.text).toBe(PLAN_VIZ_PALETTE.text);
    });

    it('brands a card with its category colour, neutral when it has none', () => {
        expect(categoryBrandColor({ color: '#ff0000' })).toBe('#ff0000');
        expect(categoryBrandColor({ color: null })).toBe(NEUTRAL_OUTLINE);
    });

    it('summarizes the facts the retired icons showed', () => {
        expect(requirementSpecSummary({ id: 9, requirement_status: 'swarm_ready',
            coordination_type: 'implemented', ai_model: 'opus', effort: 'high' }, 'review'))
            .toBe('#9 · Swarm-Start · implemented · opus · high · session review');
        expect(requirementSpecSummary({ id: '' })).toBe('');
    });
});

describe('cardFrameSx — the plan step card frame', () => {
    it('strokes the whole perimeter in the card colour at the step card radius', () => {
        const sx = cardFrameSx('#4ad9c8');
        expect(sx.border).toBe(`${CARD_FRAME_STROKE}px solid #4ad9c8`);
        expect(sx.borderRadius).toBe(`${CARD_RADIUS}px`);
        expect(sx.bgcolor).toBe(PLAN_VIZ_PALETTE.panel);
        // ONE edge: no side overrides a band could hide in.
        for (const side of ['borderTop', 'borderLeft', 'borderRight', 'borderBottom']) {
            expect(sx[side]).toBeUndefined();
        }
    });

    it('dashes the template card and rings a drop target outside the stroke', () => {
        expect(cardFrameSx('#ff0000', { dashed: true }).border).toBe(`${CARD_FRAME_STROKE}px dashed #ff0000`);
        const hi = cardFrameSx('#ff0000', { highlight: true });
        expect(hi.border).toBe(`${CARD_FRAME_STROKE}px solid #ff0000`);
        expect(hi.boxShadow).toContain(REQ_CARD_THEME.accent);
    });
});

describe('useRequirementColorKeyStore', () => {
    beforeEach(() => useRequirementColorKeyStore.setState({ colorKey: 'state' }));

    it('normalizes what it is given', () => {
        useRequirementColorKeyStore.getState().setColorKey('autonomy');
        expect(useRequirementColorKeyStore.getState().colorKey).toBe('autonomy');
        useRequirementColorKeyStore.getState().setColorKey('none');
        expect(useRequirementColorKeyStore.getState().colorKey).toBe('none');
        useRequirementColorKeyStore.getState().setColorKey('toString');
        expect(useRequirementColorKeyStore.getState().colorKey).toBe('state');
    });

    it('normalizes a persisted value on rehydration', () => {
        const merge = useRequirementColorKeyStore.persist.getOptions().merge;
        expect(merge({ colorKey: 'bogus' }, { colorKey: 'state' }).colorKey).toBe('state');
        expect(merge({ colorKey: 'effort' }, { colorKey: 'state' }).colorKey).toBe('effort');
        // A value stored while Machine was offered lands on the default.
        expect(merge({ colorKey: 'machine' }, { colorKey: 'state' }).colorKey).toBe('state');
        expect(merge(undefined, { colorKey: 'state' }).colorKey).toBe('state');
    });
});
