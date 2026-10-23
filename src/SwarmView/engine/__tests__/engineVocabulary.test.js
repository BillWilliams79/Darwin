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
    ITEM_CODES, MISSING_AFTER_SECONDS, PLAIN_WORDS, codeLabel, detailText, eventText, plainWords,
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
    });

    it('carries PLAIN_WORDS verbatim', () => {
        if (!present) return;
        const words = pyPlainWords(fs.readFileSync(CORE, 'utf8'));
        expect(Object.keys(words).length).toBe(HOLD_CODES.length + EVENT_CODES.length);
        expect(PLAIN_WORDS).toEqual(words);
    });

    it('reads missing at the heartbeat schema\'s threshold, over its four states', () => {
        if (!fs.existsSync(HEARTBEAT)) return;
        const schema = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
        expect(MISSING_AFTER_SECONDS).toBe(schema['x-missing-after-seconds']);
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
});
