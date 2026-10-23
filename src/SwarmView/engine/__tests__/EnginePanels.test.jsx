// @vitest-environment jsdom
//
// Each engine panel on its own, against fixture records `core.decide()`
// produced (req #3760): Location, Health (missing / stopped / degraded / a
// failed read), Limits (known and unknown), Decision (cut line, empty queue,
// outcomes, links) and the History strip (scrub by click and by keyboard).

import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import fixture from './engineViewFixture.json';
import { FIXTURE_NOW } from './engineTestStore';
import EngineDecisionPanel from '../EngineDecisionPanel';
import EngineHealthPanel from '../EngineHealthPanel';
import EngineHistoryStrip from '../EngineHistoryStrip';
import EngineLimitsPanel from '../EngineLimitsPanel';
import EngineLocationPanel from '../EngineLocationPanel';
import { assembleEngines, historyCells, outcomesByRequirement, recordView } from '../engineModel';

const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
const NAMES = {
    machines: byId(fixture.machines), pipelines: byId(fixture.pipelines),
    initiatives: byId(fixture.initiatives), epics: byId(fixture.epics),
};
const ENGINES = assembleEngines({ states: fixture.engine_states, heartbeats: fixture.engine_heartbeats,
    records: fixture.engine_decision_records, now: FIXTURE_NOW });
const engine = (m) => ENGINES.find((e) => e.machineId === m);
const rowsOf = (m) => fixture.engine_decision_records.filter((r) => r.machine_fk === m);

let roots = [];
function mount(el) {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => { root.render(<MemoryRouter>{el}</MemoryRouter>); });
    roots.push(root);
}
const $ = (id) => document.body.querySelector(`[data-testid="${id}"]`);
const text = (id) => ($(id) ? $(id).textContent : null);

afterEach(() => {
    act(() => { roots.forEach((r) => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
});

describe('EngineLocationPanel', () => {
    it('names the machine, scope, role, pids and claim age', () => {
        mount(<EngineLocationPanel engine={engine(1)} names={NAMES} />);
        expect(text('engine-machine-1')).toBe('Mac mini');
        expect(text('engine-scope-1')).toContain('whole plan Scenario plan');
        expect(text('engine-scope-1')).not.toContain('900');
        expect(text('engine-role-1')).toContain('lead');
        // claim_age_s 3660 at a beat 20 s old → held 1h 01m now.
        expect(text('engine-claim-1')).toBe('#1 · held 1h 01m');
        expect($('pipeline-orchestration-badge-engine-1').getAttribute('data-tone')).toBe('lead');
    });

    it('draws a subscriber in the subscriber tone — and a silent one as not alive', () => {
        mount(<EngineLocationPanel engine={engine(2)} names={NAMES} />);
        expect(text('engine-role-2')).toContain('subscriber');
        expect($('pipeline-orchestration-badge-engine-2').getAttribute('data-tone')).toBe('stale');
    });

    it('an engine turned off holds no claim', () => {
        mount(<EngineLocationPanel engine={engine(3)} names={NAMES} />);
        expect(text('engine-claim-3')).toBe('none held');
    });
});

describe('EngineHealthPanel', () => {
    it('reads a beating engine', () => {
        mount(<EngineHealthPanel engine={engine(1)} timezone="UTC" />);
        expect(text('engine-health-state-1')).toBe('ok');
        expect(text('engine-heartbeat-1')).toContain('last beat 20s ago');
        expect(text('engine-read-1')).toBe('ok · 413 ms');
        expect(text('engine-code-1')).toContain('current — running the code on disk');
        expect(text('engine-degraded-1')).toBe('no failed cycles');
        expect(text('engine-supervisor-1')).toContain('running');
        expect(text('engine-restarts-1')).toBe('not restarted');
    });

    it('says MISSING by age, with the threshold', () => {
        mount(<EngineHealthPanel engine={engine(2)} timezone="UTC" />);
        expect(text('engine-health-state-2')).toBe('missing');
        expect(text('engine-heartbeat-2')).toBe('missinglast beat 15m ago (missing after 3m)');
        expect(text('engine-restarts-2')).toBe('not supervised');
    });

    it('reads a degraded engine with a failed plan read and an unknown code verdict', () => {
        mount(<EngineHealthPanel engine={engine(4)} timezone="UTC" />);
        expect(text('engine-health-state-4')).toBe('degraded');
        expect(text('engine-read-4')).toBe('FAILED — gateway timeout on the plan read');
        expect(text('engine-degraded-4')).toBe('2 failed cycles in a row');
        expect(text('engine-code-4')).toContain('cannot tell');
        expect(text('engine-restarts-4')).toBe('restarted 3 times');
    });

    it('reads an engine turned off as stopped, with what it wanted', () => {
        mount(<EngineHealthPanel engine={engine(3)} timezone="UTC" />);
        expect(text('engine-health-state-3')).toBe('stopped');
        expect(text('engine-desired-3')).toBe('off (switched in the app)');
        expect(text('engine-code-3')).toContain('stale');
        expect(text('engine-restarts-3')).toBe('restarted 1 time');
    });

    it('says nothing about restarts for a beat that predates the count', () => {
        const e = engine(1);
        const { restarts: _omit, ...older } = e.healthJson;
        mount(<EngineHealthPanel engine={{ ...e, healthJson: older }} timezone="UTC" />);
        expect(text('engine-restarts-1')).toBe('—');
    });
});

describe('EngineLimitsPanel', () => {
    it('shows ceiling, live, reserved and free', () => {
        mount(<EngineLimitsPanel engine={engine(4)} limits={{ ceiling: 2, live: 0, reserved: 2, free: 0 }}
                                 source="at the last heartbeat" />);
        expect(text('engine-limit-ceiling-4')).toBe('ceiling 2');
        expect(text('engine-limit-reserved-4')).toBe('reserved 2');
        expect(text('engine-limit-free-4')).toBe('free 0');
        expect($('engine-limit-share-4')).toBeNull();
    });

    it('says how many of the free slots are this engine\'s when others are owed some (req #3807)', () => {
        mount(<EngineLimitsPanel engine={engine(4)}
                                 limits={{ ceiling: 4, live: 2, reserved: 0, free: 2, share: 1 }} />);
        expect(text('engine-limit-share-4')).toContain('may take 1 of the 2 free');
        expect(text('engine-limit-share-4')).toContain('owed to other engines on this machine');
    });

    it('says capacity is unknown rather than drawing zeros', () => {
        mount(<EngineLimitsPanel engine={engine(3)} limits={{ ceiling: null, live: null, reserved: null, free: null }} />);
        expect(text('engine-limits-unknown-3')).toContain('Capacity unknown this cycle');
        expect($('engine-limit-ceiling-3')).toBeNull();
    });
});

describe('EngineDecisionPanel', () => {
    const decide = (row, outcomes = new Map()) => {
        mount(<EngineDecisionPanel engine={engine(row.machine_fk)} names={NAMES} reqTitles={new Map()}
                                   timezone="UTC" view={recordView(row.record, { outcomes, names: NAMES })} />);
    };

    it('draws the queue in order, the cut where the record put it, and each epic\'s hold', () => {
        const row = rowsOf(4)[0];
        decide(row);
        const items = [...$('engine-queue-4').querySelectorAll('[data-testid^="engine-queue-item-4-"]')];
        expect(items.map((i) => i.getAttribute('data-code'))).toEqual(['ADMITTED', 'ADMITTED', 'DEP_PRIORITY']);
        expect(items.map((i) => i.getAttribute('data-below-cut'))).toEqual(['false', 'false', 'true']);
        expect($('engine-cut-4').nextElementSibling).toBe(items[2]);
        expect(text('engine-queue-item-4-3002')).toContain(
            'no slot left, and epics it depends on still hold open work — waiting on epic Epic 101');
        // Epics are named by title, never by number (req #3878).
        expect(text('engine-epic-link-4-101-0')).toBe('epic Epic 101');
        expect($('engine-epic-4-102').getAttribute('data-code')).toBe('DEP_PRIORITY');
        expect(text('engine-verdict-4')).toBe('OK');
        expect($('engine-epic-link-4-101-0').getAttribute('href'))
            .toBe('/swarm/pipeline/900?mode=plan&epic=101&level=3');
    });

    it('shows the executor\'s answer per admitted launch — failed with why, landed with its session', () => {
        const [first, , , , fifth] = rowsOf(1);
        decide(first, outcomesByRequirement(fixture.engine_outcomes, first.id));
        expect($('engine-outcome-1-3001').getAttribute('data-outcome')).toBe('failed');
        expect(text('engine-outcome-1-3001')).toContain('iTerm launch refused');
        act(() => { roots.forEach((r) => r.unmount()); });
        roots = [];
        document.body.innerHTML = '';
        decide(fifth, outcomesByRequirement(fixture.engine_outcomes, fifth.id));
        expect($('engine-outcome-1-3001').getAttribute('data-outcome')).toBe('landed');
        expect($('engine-outcome-1-3001').querySelector('a').getAttribute('href')).toBe('/swarm/session/3061');
    });

    it('says the queue is empty, and why the cycle was not trusted', () => {
        const row = rowsOf(3).find((r) => r.queue_count === 0);
        decide(row);
        expect($('engine-queue-empty-3')).not.toBeNull();
        expect($('engine-cut-3')).toBeNull();
        expect(text('engine-verdict-3')).toBe(row.verdict);
        expect(text('engine-verdict-detail-3')).toBe(row.record.cycle.verdict_detail);
        expect(text('engine-queue-empty-3')).toContain('could not trust the cycle');
    });
});

describe('EngineHistoryStrip', () => {
    it('selects a cycle by click, by keyboard and by the arrows', () => {
        const cells = historyCells(rowsOf(1));
        const onSelect = vi.fn();
        mount(<EngineHistoryStrip engineId={1} cells={cells} selectedId={cells[3].id} following={false}
                                  onSelect={onSelect} onFollow={() => {}} changes={['reserved 0 → 1']}
                                  timezone="UTC" />);
        expect(document.body.querySelectorAll('[data-testid^="engine-history-cell-1-"]')).toHaveLength(7);
        expect($(`engine-history-cell-1-${cells[3].id}`).getAttribute('aria-selected')).toBe('true');
        act(() => { $(`engine-history-cell-1-${cells[0].id}`).click(); });
        expect(onSelect).toHaveBeenLastCalledWith(cells[0].id);
        act(() => { $('engine-history-next-1').click(); });
        expect(onSelect).toHaveBeenLastCalledWith(cells[4].id);
        const strip = document.body.querySelector('[role="listbox"]');
        act(() => { strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
        expect(onSelect).toHaveBeenLastCalledWith(cells[2].id);
        expect(text('engine-changes-1')).toContain('reserved 0 → 1');
        expect($('engine-history-latest-1').getAttribute('aria-pressed')).toBe('false');
    });

    it('disables moving past either end', () => {
        const cells = historyCells(rowsOf(2));
        mount(<EngineHistoryStrip engineId={2} cells={cells} selectedId={cells[0].id} following
                                  onSelect={() => {}} onFollow={() => {}} changes={[]} timezone="UTC" />);
        expect($('engine-history-prev-2').disabled).toBe(true);
        expect($('engine-history-next-2').disabled).toBe(true);
        expect(text('engine-changes-2')).toBe('Nothing changed from the cycle before.');
    });
});
