// The engine's words in the browser are the engine's words (req #3760).
//
// `engineVocabulary.js` copies core.py's PLAIN_WORDS and code tuples, and the
// heartbeat schema's missing threshold, because the browser cannot import the
// engine's Python. This holds the copy to the source: it reads
// `scripts/swarm/engine2/core.py` and `contracts/heartbeat.schema.json` from
// the workspace and fails on any difference — a renamed code, a reworded
// sentence, a moved threshold. A Darwin checkout on its own (no workspace
// around it) skips the comparison, as requirementFilerModel.test.js does.

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
    CODE_COLORS, CODE_LABELS, EPIC_CODES, EVENT_CODES, HEALTH_COLORS, HEALTH_STATES, HOLD_CODES,
    SHELL_EVENT_CODES,
    ITEM_CODES, MISSED_INTERVALS, MISSING_AFTER_SECONDS, PLAIN_WORDS, codeLabel, desiredReasonText, detailText, eventText,
    initiativeName, plainWords,
} from '../engineVocabulary';

const ENGINE2 = path.resolve(__dirname, '../../../../../scripts/swarm/engine2');
const CORE = path.join(ENGINE2, 'core.py');
const HEARTBEAT = path.join(ENGINE2, 'contracts', 'heartbeat.schema.json');

const pyTuple = (src, name) => {
    const m = src.match(new RegExp(`^${name} = \\(([^)]*)\\)`, 'm'));
    if (!m) throw new Error(`${name} not found in core.py`);
    return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
};

const pyPlainWords = (src) => {
    const block = src.match(/^PLAIN_WORDS = \{\n([\s\S]*?)\n\}/m);
    if (!block) throw new Error('PLAIN_WORDS not found in core.py');
    const out = {};
    for (const line of block[1].split('\n')) {
        const m = line.match(/^\s*'([A-Z_]+)': (['"])(.*)\2,\s*$/);
        if (m) out[m[1]] = m[3].replace(/\\'/g, "'");
    }
    return out;
};

describe('engine vocabulary — held to scripts/swarm/engine2/core.py', () => {
    const present = fs.existsSync(CORE);

    it('carries the same epic, item and event codes, in precedence order', () => {
        if (!present) return;
        const src = fs.readFileSync(CORE, 'utf8');
        expect(EPIC_CODES).toEqual(pyTuple(src, 'EPIC_CODES'));
        expect(ITEM_CODES).toEqual(pyTuple(src, 'ITEM_CODES'));
        expect(EVENT_CODES).toEqual(pyTuple(src, 'EVENT_CODES'));
        expect(SHELL_EVENT_CODES).toEqual(pyTuple(src, 'SHELL_EVENT_CODES'));
    });

    it('carries PLAIN_WORDS verbatim', () => {
        if (!present) return;
        const words = pyPlainWords(fs.readFileSync(CORE, 'utf8'));
        expect(Object.keys(words).length).toBe(
            HOLD_CODES.length + EVENT_CODES.length + SHELL_EVENT_CODES.length);
        expect(PLAIN_WORDS).toEqual(words);
    });

    it('reads missing at the heartbeat schema\'s threshold, over its four states', () => {
        if (!fs.existsSync(HEARTBEAT)) return;
        const schema = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
        expect(MISSING_AFTER_SECONDS).toBe(schema['x-missing-after-seconds']);
        expect(MISSED_INTERVALS).toBe(schema['x-missed-intervals']);
        expect(HEALTH_STATES).toEqual(schema['x-health-states']);
    });
});

describe('engine vocabulary — every code has a label, a colour and a sentence', () => {
    it('covers the whole vocabulary', () => {
        for (const code of [...HOLD_CODES, ...EVENT_CODES]) {
            expect(CODE_LABELS[code], code).toBeTruthy();
            expect(CODE_COLORS[code], code).toMatch(/^#[0-9a-f]{6}$/i);
            expect(plainWords(code)).toBe(PLAIN_WORDS[code]);
        }
        for (const h of HEALTH_STATES) expect(HEALTH_COLORS[h], h).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('keeps held amber and inert grey off the closed-status greens (req #3905)', () => {
        // Aurora's `deferred`/`wontfix` are greens since req #3905; a held or
        // degraded engine state borrowing them would read as healthy/finished.
        const held = ['PAUSED', 'INITIATIVE_GATE', 'BARRIER', 'NOT_BEFORE'].map((c) => CODE_COLORS[c]);
        const inert = ['CLOSED', 'NO_WORK', 'MANUAL', 'DRAINED'].map((c) => CODE_COLORS[c]);
        expect(new Set([...held, HEALTH_COLORS.degraded])).toEqual(new Set(['#fcd34d']));
        expect(new Set([...inert, HEALTH_COLORS.stopped])).toEqual(new Set(['#94a3b8']));
    });

    it('names an unknown code instead of going blank', () => {
        expect(plainWords('NEW_CODE')).toBe('unrecognised code NEW_CODE');
        expect(codeLabel('NEW_CODE')).toBe('NEW_CODE');
    });

    it('puts each code\'s detail into words', () => {
        expect(detailText('BARRIER', { barrier_epic_ids: [12] })).toBe('held by barrier epic 12');
        expect(detailText('DEP_PRIORITY', { waiting_on_epic_ids: [101, 102] }))
            .toBe('waiting on epics 101, 102');
        expect(detailText('PAUSED', { by: ['plan'] })).toBe('paused at the plan');
        expect(detailText('MACHINE_PIN', { pinned_to: 'Any', role: 'subscriber' }))
            .toBe('any machine (another engine leads it); this engine is subscriber');
        expect(detailText('MACHINE_PIN', { pinned_to: 1, role: 'lead' }))
            .toBe('machine 1; this engine is lead');
        expect(detailText('IN_FLIGHT', { announced_at: '2026-10-22T08:00:00Z', attempts: 2, outcome: 'pending' }))
            .toBe('announced 2026-10-22T08:00:00Z, attempt 2, waiting for the executor');
        expect(detailText('ADMITTED', { reannounce: 3 })).toBe('announced again (attempt 3)');
        expect(detailText('ADMITTED', null)).toBe('');
        // A held-for-a-person epic names the requirements; the plain words already say "for a person".
        expect(detailText('MANUAL', { requirement_ids: [5585] })).toBe('requirement 5585');
        // No-work reasons read as a sentence; one in another shape is shown as written.
        expect(detailText('NO_WORK', { reason: 'nothing launchable — only swarm_ready launches: 3764 development, 3765 approved' }))
            .toBe('nothing launchable — only swarm_ready work launches; #3764 is development, #3765 is approved');
        expect(detailText('NO_WORK', { reason: 'every requirement is met' })).toBe('every requirement is met');
        expect(detailText('ENGINE_HOLD', { verdict: 'CAPACITY-UNKNOWN' })).toBe('verdict CAPACITY-UNKNOWN');
    });

    it('puts each event into one sentence', () => {
        expect(eventText({ code: 'LANDED', requirement_id: 7, epic_id: 3, status: 'met' }))
            .toBe('a requirement reached a terminal status: requirement 7 on epic 3 is met');
        expect(eventText({ code: 'REGRESSION', requirement_id: 7, epic_id: 3, from: 'met', to: 'development' }))
            .toBe('finished work re-opened: requirement 7 on epic 3 went met → development');
        expect(eventText({ code: 'DRAINED', since: '2026-10-22T08:00:00Z' }))
            .toBe('no epic in scope holds open work since 2026-10-22T08:00:00Z');
    });

    it('names epics and initiatives by title when the names are known (req #3878)', () => {
        const names = {
            epics: new Map([[12, { id: 12, title: 'Foundation' }], [101, { id: 101, title: 'Alpha' }]]),
            initiatives: new Map([[5, { id: 5, title: 'Engine cutover' }]]),
        };
        expect(detailText('BARRIER', { barrier_epic_ids: [12] }, names)).toBe('held by barrier epic Foundation');
        // An untitled id falls back to its number rather than going blank.
        expect(detailText('DEP_PRIORITY', { waiting_on_epic_ids: [101, 102] }, names))
            .toBe('waiting on epics Alpha, 102');
        expect(initiativeName(5, names)).toBe('initiative Engine cutover');
        expect(eventText({ code: 'LANDED', requirement_id: 7, epic_id: 12, status: 'met' }, names))
            .toBe('a requirement reached a terminal status: requirement 7 on epic Foundation is met');
        expect(eventText({ code: 'TOP_UP', epic_id: 12, requirement_ids: [7, 8] }, names))
            .toBe('new work seated on an epic already under way: epic Foundation gained requirements 7, 8');
        expect(eventText({ code: 'STALL', requirement_id: 7, epic_id: 101 }, names))
            .toBe('open work in development that nobody is working: requirement 7 on epic Alpha');
    });
});

describe('engine vocabulary — why the switch is where it is', () => {
    it('puts a switch reason in words and leaves an unknown one as written', () => {
        expect(desiredReasonText('pipeline-start')).toBe('by /pipeline-start');
        expect(desiredReasonText('adopted')).toContain('no switch');
        expect(desiredReasonText('somebody-new')).toBe('somebody-new');
    });
});
