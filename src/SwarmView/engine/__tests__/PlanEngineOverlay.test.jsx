// @vitest-environment jsdom
//
// The plan overlay's two pieces on their own (req #3762), over decide()'s
// records (planOverlayFixture.json): the strip — switch, state, source, limits,
// the queue with its cut line — and an epic card's badge with the hold in the
// engine view's plain words on hover.

import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import fixture from './planOverlayFixture.json';
import { SOURCE_ENGINE, SOURCE_PREDICTED, planOverlay } from '../engineOverlay';
import { PLAIN_WORDS } from '../engineVocabulary';
import PlanEngineBadge from '../PlanEngineBadge';
import PlanEngineStrip, { engineStateText } from '../PlanEngineStrip';

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

describe('PlanEngineStrip', () => {
    it('draws the switch, the record\'s cycle, the limits and the cut where the record put it', () => {
        mount(<PlanEngineStrip ctl={ctlOf()} machines={MACHINES} open onToggleOpen={() => {}}
                               onPickMachine={() => {}} />);
        expect($('plan-engine-switch').getAttribute('data-on')).toBe('true');
        expect(text('plan-engine-switch')).toBe('Engine on');
        expect(text('plan-engine-machine')).toBe('on Mac mini');
        expect(text('plan-engine-state')).toBe('on — running, beating (12s ago)');
        expect($('plan-engine-source').getAttribute('data-source')).toBe('engine');
        expect(text('plan-engine-source')).toContain('Engine cycle 1');
        expect(text('plan-engine-limit-ceiling')).toBe('ceiling 2');
        expect(text('plan-engine-limit-live')).toBe('live 0');
        expect(text('plan-engine-limit-reserved')).toBe('reserved 0');
        expect(text('plan-engine-limit-free')).toBe('free 2');
        expect(text('plan-engine-cut-text')).toBe('the slots run out after #2');
        // The queue in the record's order, the cut drawn before its third item.
        const kids = [...$('plan-engine-queue').children].map((n) => n.getAttribute('data-testid'));
        expect(kids).toEqual(['plan-engine-queue-item-3001', 'plan-engine-queue-item-3003',
            'plan-engine-cut', 'plan-engine-queue-item-3002']);
        expect($('plan-engine-queue-item-3002').getAttribute('data-code')).toBe('DEP_PRIORITY');
        expect($('plan-engine-queue-item-3002').getAttribute('data-below-cut')).toBe('true');
        expect($('plan-engine-queue-item-3001').textContent).toContain('Mac mini');
    });

    it('flips the switch', () => {
        const ctl = ctlOf({ engineOn: false, engine: engineRow('off', 'stopped', 'stopped', null),
            overlay: overlayOf('A16', 0, SOURCE_PREDICTED) });
        mount(<PlanEngineStrip ctl={ctl} machines={MACHINES} open onToggleOpen={() => {}}
                               onPickMachine={() => {}} />);
        expect(text('plan-engine-switch')).toBe('Engine off');
        expect(text('plan-engine-state')).toBe('off — stopped');
        expect($('plan-engine-source').getAttribute('data-source')).toBe('predicted');
        act(() => { $('plan-engine-switch').click(); });
        expect(ctl.toggle).toHaveBeenCalledTimes(1);
    });

    it('says when capacity is unknown, and when a switch failed', () => {
        const overlay = { ...overlayOf('A16', 0), limitsKnown: false };
        mount(<PlanEngineStrip ctl={ctlOf({ overlay, error: 'HTTP 500' })} machines={MACHINES} open
                               onToggleOpen={() => {}} onPickMachine={() => {}} />);
        expect($('plan-engine-limits-unknown')).not.toBeNull();
        expect(text('plan-engine-error')).toContain('HTTP 500');
    });

    it('asks for the machine when the browser cannot tell which it is on', () => {
        const ctl = ctlOf({ machineId: null, machine: null, machineResolved: false, overlay: null,
            engine: null, engineOn: false, openMachines: fixture.machines });
        mount(<PlanEngineStrip ctl={ctl} machines={MACHINES} open onToggleOpen={() => {}}
                               onPickMachine={() => {}} />);
        expect($('plan-engine-switch').disabled).toBe(true);
        expect(text('plan-engine-source')).toBe('Pick this machine to see the launch order');
        expect($('plan-engine-machine-select')).not.toBeNull();
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
            .toBe(`Barrier — ${PLAIN_WORDS.BARRIER} — held by barrier epic 101`);
        expect(text('plan-engine-hold-102')).toContain("From the engine's cycle 1.");
    });
});
