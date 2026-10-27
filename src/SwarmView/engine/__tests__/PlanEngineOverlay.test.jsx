// @vitest-environment jsdom
//
// The plan overlay's two pieces on their own (req #3762), over decide()'s
// records (planOverlayFixture.json): the engine box — an Action Popup since req
// #3935, cut to its switch, role and slots by req #3981 — and an epic card's
// badge with the hold in the engine view's plain words on hover.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import fixture from './planOverlayFixture.json';
import { SOURCE_ENGINE, SOURCE_PREDICTED, planOverlay } from '../engineOverlay';
import { PLAIN_WORDS } from '../engineVocabulary';
import PlanEngineBadge from '../PlanEngineBadge';
import PlanEngineBox, { ENGINE_HOME, engineStateText } from '../PlanEngineBox';
import { usePlanEngineBoxStore } from '../../../stores/usePlanEngineBoxStore';

const MACHINES = new Map(fixture.machines.map((m) => [m.id, m]));
const state = (id, i) => fixture.actions.find((a) => a.action === id).states[i];
const overlayOf = (id, i, source = SOURCE_ENGINE) => planOverlay(state(id, i).record_row.record,
    { source, payload: state(id, i).payload, liveClaims: [] });

const engineRow = (desired, actual, health = 'ok', beatAgeSeconds = 12) => ({
    state: { desired_state: desired, actual_state: actual, actual_detail: null },
    health, beatAgeSeconds,
});

function ctlOf(overrides) {
    return {
        overlay: overlayOf('A16', 0),
        engine: engineRow('on', 'running'),
        engineOn: true,
        machineId: 1,
        machine: MACHINES.get(1),
        machineResolved: true,
        openMachines: [MACHINES.get(1)],
        readErrors: [],
        pending: null,
        error: null,
        toggle: vi.fn(),
        ...overrides,
    };
}

let roots = [];
function mount(el) {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => { root.render(el); });
    roots.push(root);
}
const $ = (id) => document.body.querySelector(`[data-testid="${id}"]`);
const text = (id) => ($(id) ? $(id).textContent : null);

afterEach(() => {
    act(() => { roots.forEach((r) => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
});

describe('PlanEngineBox', () => {
    beforeEach(() => { usePlanEngineBoxStore.setState({ open: true, dock: null }); });

    it('is an Action Popup titled Engine, homed bottom-right, folding to its head (req #3935)', () => {
        mount(<PlanEngineBox ctl={ctlOf()} />);
        const box = $('plan-engine-box');
        expect(text('plan-engine-box-title')).toBe('Engine');
        expect(box.getAttribute('data-rack-id')).toBe('engine');
        expect(box.getAttribute('data-dock')).toBe(`${ENGINE_HOME.h}${ENGINE_HOME.x},${ENGINE_HOME.v}${ENGINE_HOME.y}`);
        // Open, no power button beside the title (req #3981).
        expect($('plan-engine-box-power')).toBeNull();
        act(() => { $('plan-engine-box-toggle').click(); });
        expect(usePlanEngineBoxStore.getState().open).toBe(false);
        expect($('plan-engine-box-body').getAttribute('data-folded')).toBe('1');
        // Folded, the switch rides the head beside the title, the slots after it.
        expect($('plan-engine-box-badge').contains($('plan-engine-box-power'))).toBe(true);
        // Pips alone, no "0/2" (req #3981); the count rides the attributes.
        expect(text('plan-engine-box-slots')).toBe('');
        expect($('plan-engine-box-slots').getAttribute('data-taken')).toBe('0');
        expect($('plan-engine-box-slots').getAttribute('data-ceiling')).toBe('2');
        expect($('plan-engine-box-header').contains($('plan-engine-box-slots'))).toBe(true);
    });

    it('folded and off, the head shows no slots', () => {
        usePlanEngineBoxStore.setState({ open: false, dock: null });
        mount(<PlanEngineBox ctl={ctlOf({ engineOn: false, engine: engineRow('off', 'stopped', 'stopped', null),
            overlay: overlayOf('A16', 0, SOURCE_PREDICTED) })} />);
        expect($('plan-engine-box-power').getAttribute('data-on')).toBe('false');
        expect($('plan-engine-box-slots')).toBeNull();
    });

    it('folded, the head\'s power button is the switch (req #3981)', () => {
        usePlanEngineBoxStore.setState({ open: false, dock: null });
        const ctl = ctlOf();
        mount(<PlanEngineBox ctl={ctl} />);
        const power = $('plan-engine-box-power');
        expect(power.getAttribute('data-on')).toBe('true');
        expect(power.getAttribute('aria-pressed')).toBe('true');
        act(() => { power.click(); });
        expect(ctl.toggle).toHaveBeenCalledTimes(1);
        // The click does not fold or unfold the popup.
        expect(usePlanEngineBoxStore.getState().open).toBe(false);
    });

    it('folded, the power button waits while a switch is in flight, and with no machine', () => {
        usePlanEngineBoxStore.setState({ open: false, dock: null });
        const ctl = ctlOf({ pending: 'off' });
        mount(<PlanEngineBox ctl={ctl} />);
        const power = $('plan-engine-box-power');
        expect(power.getAttribute('aria-disabled')).toBe('true');
        expect(power.getAttribute('data-pending')).toBe('off');
        act(() => { power.click(); });
        expect(ctl.toggle).not.toHaveBeenCalled();
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        const none = ctlOf({ machineId: null, machine: null, machineResolved: false });
        mount(<PlanEngineBox ctl={none} />);
        act(() => { $('plan-engine-box-power').click(); });
        expect($('plan-engine-box-power').getAttribute('aria-disabled')).toBe('true');
        expect(none.toggle).not.toHaveBeenCalled();
    });

    it('draws ON, the role and the slots taken of the capacity (req #3981)', () => {
        mount(<PlanEngineBox ctl={ctlOf()} />);
        expect($('plan-engine-switch').getAttribute('data-on')).toBe('true');
        expect(text('plan-engine-switch')).toBe('ON');
        expect(text('plan-engine-role')).toBe('Primary');
        expect($('plan-engine-strip').getAttribute('data-source')).toBe('engine');
        expect($('plan-engine-strip').getAttribute('data-seq')).toBe('1');
        const slots = $('plan-engine-slots');
        expect(slots.getAttribute('data-taken')).toBe('0');
        expect(slots.getAttribute('data-ceiling')).toBe('2');
        expect(slots.textContent).toBe('0/2');
        // Nothing else: no machine, no source line, no limits list, no queue.
        for (const gone of ['plan-engine-machine', 'plan-engine-state', 'plan-engine-source',
            'plan-engine-limits', 'plan-engine-queue', 'plan-engine-cut-text']) {
            expect($(gone)).toBeNull();
        }
    });

    it('names a subscriber Secondary, and shows no role for none', () => {
        const sub = { ...overlayOf('A16', 0), role: 'subscriber' };
        mount(<PlanEngineBox ctl={ctlOf({ overlay: sub })} />);
        expect(text('plan-engine-role')).toBe('Secondary');
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        mount(<PlanEngineBox ctl={ctlOf({ overlay: { ...overlayOf('A16', 0), role: 'refused' } })}
                             />);
        expect($('plan-engine-role')).toBeNull();
    });

    it('reports a role, never predicts one (switched on, not yet published)', () => {
        const predicted = { ...overlayOf('A16', 0, SOURCE_PREDICTED), role: 'lead' };
        mount(<PlanEngineBox ctl={ctlOf({ overlay: predicted, engine: engineRow('on', 'starting', 'missing', null) })}
                             />);
        expect($('plan-engine-role')).toBeNull();
    });

    it('takes the role from a beating engine\'s heartbeat until its record loads', () => {
        const engine = { ...engineRow('on', 'running'), beat: { role: 'subscriber' } };
        mount(<PlanEngineBox ctl={ctlOf({ overlay: null, engine })} />);
        expect(text('plan-engine-role')).toBe('Secondary');
        // No record yet: the slots are loading, not unknown.
        expect($('plan-engine-slots').getAttribute('data-known')).toBe('loading');
        expect(text('plan-engine-slots')).toBe('…/…');
    });

    it('outlines the switch when a read failed', () => {
        mount(<PlanEngineBox ctl={ctlOf({ readErrors: ['engine states'] })} />);
        expect($('plan-engine-switch').getAttribute('data-fault')).toBe('true');
    });

    it('takes the slots from a beating engine\'s heartbeat until its record loads', () => {
        const engine = { ...engineRow('on', 'running'), beat: { role: 'lead' },
            healthJson: { limits: { ceiling: 8, live: 1, reserved: 0, free: 7 } } };
        mount(<PlanEngineBox ctl={ctlOf({ overlay: null, engine })} />);
        expect(text('plan-engine-slots')).toBe('1/8');
    });

    it('never shows a prediction\'s slots, even switched on', () => {
        mount(<PlanEngineBox ctl={ctlOf({ overlay: overlayOf('A16', 0, SOURCE_PREDICTED),
            engine: engineRow('on', 'starting', 'ok', 5) })} />);
        expect($('plan-engine-slots').getAttribute('data-known')).toBe('loading');
    });

    it('says unknown, not loading, for an engine switched on but silent', () => {
        mount(<PlanEngineBox ctl={ctlOf({ overlay: overlayOf('A16', 0, SOURCE_PREDICTED),
            engine: engineRow('on', 'starting', 'missing', null) })} />);
        expect($('plan-engine-slots').getAttribute('data-known')).toBe('false');
    });

    it('counts live and reserved as taken', () => {
        const base = overlayOf('A16', 0);
        const overlay = { ...base, limits: { ...base.limits, ceiling: 6, live: 2, reserved: 1 } };
        mount(<PlanEngineBox ctl={ctlOf({ overlay })} />);
        expect(text('plan-engine-slots')).toBe('3/6');
    });

    it('flips the switch', () => {
        const ctl = ctlOf({ engineOn: false, engine: engineRow('off', 'stopped', 'stopped', null),
            overlay: overlayOf('A16', 0, SOURCE_PREDICTED) });
        mount(<PlanEngineBox ctl={ctl} />);
        expect(text('plan-engine-switch')).toBe('OFF');
        // Off, it holds no role and no slots: neither is drawn (req #3981).
        expect($('plan-engine-role')).toBeNull();
        expect($('plan-engine-slots')).toBeNull();
        expect($('plan-engine-switch').getAttribute('data-fault')).toBe('false');
        expect($('plan-engine-strip').getAttribute('data-source')).toBe('predicted');
        act(() => { $('plan-engine-switch').click(); });
        expect(ctl.toggle).toHaveBeenCalledTimes(1);
    });

    it('says when capacity is unknown, and when a switch failed', () => {
        const overlay = { ...overlayOf('A16', 0), limitsKnown: false };
        mount(<PlanEngineBox ctl={ctlOf({ overlay, error: 'HTTP 500' })} />);
        expect($('plan-engine-slots').getAttribute('data-known')).toBe('false');
        expect(text('plan-engine-slots')).toBe('?/?');
        expect($('plan-engine-switch').getAttribute('data-fault')).toBe('true');
    });

    it('has no machine picker: with no machine the switch waits (req #3981)', () => {
        const ctl = ctlOf({ machineId: null, machine: null, machineResolved: false, overlay: null,
            engine: null, engineOn: false, openMachines: fixture.machines });
        mount(<PlanEngineBox ctl={ctl} />);
        expect($('plan-engine-switch').disabled).toBe(true);
        expect($('plan-engine-machine-select')).toBeNull();
    });

    it('phrases the switch and the supervisor together', () => {
        expect(engineStateText(null)).toMatch(/^off — never switched on/);
        expect(engineStateText(engineRow('on', 'starting'))).toBe('on — starting');
        expect(engineStateText(engineRow('on', 'running', 'missing', 900)))
            .toBe('on — running, but no heartbeat for 15m');
        expect(engineStateText(engineRow('off', 'stopping'))).toBe('switched off — the supervisor reports stopping');
    });
});

describe('PlanEngineBadge', () => {
    it('numbers an epic by its queue positions and marks the cut', () => {
        const overlay = overlayOf('A16', 0);
        mount(<PlanEngineBadge badge={overlay.badges.get(102)} overlay={overlay} machines={MACHINES}
                               thisMachineId={1} style={{ left: 0, top: 0 }} />);
        const badge = $('plan-engine-badge-102');
        expect(badge.textContent).toBe('3');
        expect(badge.getAttribute('data-code')).toBe('DEP_PRIORITY');
        expect(badge.getAttribute('data-cut-before')).toBe('true');
        expect(badge.getAttribute('data-below-cut')).toBe('true');
        expect(badge.getAttribute('aria-label')).toBe(
            `Epic 102: Dep priority — ${PLAIN_WORDS.DEP_PRIORITY}`);
    });

    it('names the machine a launch runs on when it is not this one', () => {
        const s = state('A12', 1);
        const overlay = planOverlay(s.record_row.record, { source: SOURCE_ENGINE, payload: s.payload,
            liveClaims: [{ id: 1, pipeline_fk: 900, initiative_fk: null, machine_fk: 1 }] });
        mount(<PlanEngineBadge badge={overlay.badges.get(101)} overlay={overlay} machines={MACHINES}
                               thisMachineId={1} style={{ left: 0, top: 0 }} />);
        expect(text('plan-engine-badge-machine-101')).toBe('→ WSL box');
    });

    it('gives the hold in the engine view\'s plain words on hover', async () => {
        const overlay = overlayOf('A8', 0);
        mount(<PlanEngineBadge badge={overlay.badges.get(102)} overlay={overlay} machines={MACHINES}
                               thisMachineId={1} title="Epic 102" style={{ left: 0, top: 0 }} />);
        expect(text('plan-engine-badge-102')).toBe('Barrier');
        await act(async () => {
            $('plan-engine-badge-102').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 150));
        });
        expect(text('plan-engine-hold-words-102'))
            .toBe(`Barrier — ${PLAIN_WORDS.BARRIER} — held by barrier epic Epic 101`);
        expect(text('plan-engine-hold-102')).toContain("From the engine's cycle 1.");
    });
});
