// engineVocabulary.js — the engine's closed vocabulary in plain words (req #3760).
//
// ONE COPY FOR THE BROWSER. The authority is `scripts/swarm/engine2/core.py`:
// its code tuples (rule R9) and its `PLAIN_WORDS` table are what `render()`
// prints for a decision record. The browser reaches Lambda-Rest, never the
// engine's Python, so the words are COPIED here and held to that file by
// `__tests__/engineVocabulary.test.js`, which reads core.py and fails on any
// difference. The plan overlay (req #3762) imports the same words from here so
// the engine view and the plan view never phrase one code two ways.
//
// NO JSX: importable by vitest without a DOM, and by every surface that needs a
// sentence rather than a component.

import { DEFAULT_PLAN_PALETTE, planPalette } from '../pipelines/pipelinePlanLayout';

// core.py EPIC_CODES / ITEM_CODES / EVENT_CODES, in the charter's precedence order.
export const EPIC_CODES = ['ENGINE_HOLD', 'PAUSED', 'SERIAL_TURN', 'BARRIER', 'NOT_BEFORE',
    'NO_WORK', 'MANUAL'];
export const ITEM_CODES = ['MACHINE_PIN', 'IN_FLIGHT', 'DEP_PRIORITY', 'CAPACITY', 'ADMITTED'];
export const HOLD_CODES = [...EPIC_CODES, ...ITEM_CODES];
export const EVENT_CODES = ['REGRESSION', 'TOP_UP', 'DRAINED', 'LANDED', 'STALL', 'VIOLATION'];
// core.py SHELL_EVENT_CODES — measured by the live process (engine2/run.py, req
// #3757) and appended to a record's events after decide() returns.
export const SHELL_EVENT_CODES = ['CODE_STALE'];

export const VERDICT_OK = 'OK';

// core.py PLAIN_WORDS, verbatim.
export const PLAIN_WORDS = {
    ENGINE_HOLD: 'the engine cannot trust this cycle, so everything waits',
    PAUSED: 'someone paused the plan or the initiative',
    SERIAL_TURN: "serial plan, and it is not this initiative's turn",
    BARRIER: 'a barrier epic upstream still holds open work',
    NOT_BEFORE: 'its start time has not come',
    NO_WORK: 'its open work holds nothing swarm-ready',
    MANUAL: 'run=manual — announced for a person, never launched',
    MACHINE_PIN: 'it belongs to another machine or another lead',
    IN_FLIGHT: 'already announced, waiting to see it start',
    DEP_PRIORITY: 'no slot left, and epics it depends on still hold open work',
    CAPACITY: 'no free slot for this engine — full, or owed to a waiting engine that holds fewer',
    ADMITTED: 'goes now',
    REGRESSION: 'finished work re-opened',
    TOP_UP: 'new work seated on an epic already under way',
    DRAINED: 'no epic in scope holds open work',
    LANDED: 'a requirement reached a terminal status',
    STALL: 'open work in development that nobody is working',
    VIOLATION: 'the derivation reported a plan violation',
    CODE_STALE: 'the engine is running code that changed on disk',
};

/** The plain words for a code; an unknown code says so rather than going blank. */
export const plainWords = (code) => PLAIN_WORDS[code] || `unrecognised code ${code}`;

// Short labels for chips. The plain words are the sentence; these are the badge.
export const CODE_LABELS = {
    ENGINE_HOLD: 'Engine hold',
    PAUSED: 'Paused',
    SERIAL_TURN: 'Serial turn',
    BARRIER: 'Barrier',
    NOT_BEFORE: 'Not before',
    NO_WORK: 'No work',
    MANUAL: 'Manual',
    MACHINE_PIN: 'Machine pin',
    IN_FLIGHT: 'In flight',
    DEP_PRIORITY: 'Dep priority',
    CAPACITY: 'Capacity',
    ADMITTED: 'Admitted',
    REGRESSION: 'Regression',
    TOP_UP: 'Top-up',
    DRAINED: 'Drained',
    LANDED: 'Landed',
    STALL: 'Stall',
    VIOLATION: 'Violation',
    CODE_STALE: 'Code stale',
};
export const codeLabel = (code) => CODE_LABELS[code] || code;

// ── Health (heartbeat.schema.json, darwin-mcp services/engine2.py) ─────────
// `x-missing-after-seconds`: a beat older than this reads `missing` while the
// engine is wanted on. Held to the schema by the vocabulary test.
export const MISSING_AFTER_SECONDS = 180;
export const HEALTH_OK = 'ok';
export const HEALTH_DEGRADED = 'degraded';
export const HEALTH_MISSING = 'missing';
export const HEALTH_STOPPED = 'stopped';
export const HEALTH_STATES = [HEALTH_OK, HEALTH_DEGRADED, HEALTH_MISSING, HEALTH_STOPPED];

export const HEALTH_WORDS = {
    [HEALTH_OK]: 'beating',
    [HEALTH_DEGRADED]: 'beating, but its last cycles failed',
    [HEALTH_MISSING]: 'no heartbeat — wanted on, but silent',
    [HEALTH_STOPPED]: 'turned off',
};

// engine_states.actual_state — what the supervisor reports (desired_state.schema.json).
export const ACTUAL_STATE_WORDS = {
    stopped: 'stopped',
    starting: 'starting',
    running: 'running',
    stopping: 'stopping',
    crashed: 'crashed',
};

// heartbeat.schema.json health.code_verdict.
export const CODE_VERDICT_WORDS = {
    current: 'running the code on disk',
    stale: 'running code older than the code on disk',
    unknown: 'cannot tell whether its code is current',
    'not-recorded': 'did not record its code version',
};

export const OUTCOME_PENDING = 'pending';
export const OUTCOME_LANDED = 'landed';
export const OUTCOME_FAILED = 'failed';
export const OUTCOME_WORDS = {
    [OUTCOME_PENDING]: 'waiting for the executor',
    [OUTCOME_LANDED]: 'session started',
    [OUTCOME_FAILED]: 'launch failed',
};

// ── Colours — the plan view's own status colours (aurora, the theme the plan
// canvas draws; `DEFAULT_PLAN_PALETTE`). Mapped by MEANING, never a new hex:
// goes now / landed / healthy read as the requirement `met` green, waiting-to-
// start as `development`, queued-for-a-slot as `swarm_ready`, held by the plan
// as `deferred`, needs-a-human as the session `review` attention red, and
// nothing-to-do as `wontfix` grey.
const PALETTE = planPalette(DEFAULT_PLAN_PALETTE);
const S = PALETTE.status;
const ATTENTION = PALETTE.session.review;

export const CODE_COLORS = {
    ENGINE_HOLD: ATTENTION,
    PAUSED: S.deferred,
    SERIAL_TURN: S.deferred,
    BARRIER: S.deferred,
    NOT_BEFORE: S.deferred,
    NO_WORK: S.wontfix,
    MANUAL: S.wontfix,
    MACHINE_PIN: S.approved,
    IN_FLIGHT: S.development,
    DEP_PRIORITY: S.swarm_ready,
    CAPACITY: S.swarm_ready,
    ADMITTED: S.met,
    REGRESSION: ATTENTION,
    TOP_UP: S.swarm_ready,
    DRAINED: S.wontfix,
    LANDED: S.met,
    STALL: ATTENTION,
    VIOLATION: ATTENTION,
    CODE_STALE: ATTENTION,
};
export const codeColor = (code) => CODE_COLORS[code] || S.wontfix;

export const HEALTH_COLORS = {
    [HEALTH_OK]: S.met,
    [HEALTH_DEGRADED]: S.deferred,
    [HEALTH_MISSING]: ATTENTION,
    [HEALTH_STOPPED]: S.wontfix,
};

export const OUTCOME_COLORS = {
    [OUTCOME_PENDING]: S.development,
    [OUTCOME_LANDED]: S.met,
    [OUTCOME_FAILED]: ATTENTION,
};

// ── Detail sentences ─────────────────────────────────────────────────────────

const list = (ids, noun) => {
    const xs = Array.isArray(ids) ? ids : [];
    if (!xs.length) return `no ${noun}`;
    return `${noun}${xs.length === 1 ? '' : 's'} ${xs.join(', ')}`;
};

/**
 * The detail a code carries (core.py's `detail` dicts), as a phrase a reader
 * finishes the plain words with — or '' when there is nothing to add.
 */
export function detailText(code, detail) {
    if (!detail || typeof detail !== 'object') return '';
    switch (code) {
        case 'ENGINE_HOLD':
            return detail.verdict ? `verdict ${detail.verdict}` : '';
        case 'PAUSED':
            return Array.isArray(detail.by) && detail.by.length
                ? `paused at the ${detail.by.join(' and the ')}` : '';
        case 'SERIAL_TURN':
            return detail.live_initiative_id != null
                ? `initiative ${detail.live_initiative_id} has the turn` : 'no initiative has the turn';
        case 'BARRIER':
            return `held by barrier ${list(detail.barrier_epic_ids, 'epic')}`;
        case 'NOT_BEFORE':
            return detail.not_before ? `starts at ${detail.not_before}` : '';
        case 'NO_WORK':
            return detail.reason ? String(detail.reason) : '';
        case 'MANUAL':
            return `for a person: ${list(detail.requirement_ids, 'requirement')}`;
        case 'MACHINE_PIN': {
            const to = detail.pinned_to === 'Any' ? 'any machine (another engine leads it)'
                : `machine ${detail.pinned_to}`;
            return `${to}${detail.role ? `; this engine is ${detail.role}` : ''}`;
        }
        case 'IN_FLIGHT': {
            const parts = [];
            if (detail.announced_at) parts.push(`announced ${detail.announced_at}`);
            if (detail.attempts > 1) parts.push(`attempt ${detail.attempts}`);
            if (detail.outcome) parts.push(OUTCOME_WORDS[detail.outcome] || detail.outcome);
            return parts.join(', ');
        }
        case 'DEP_PRIORITY':
            return `waiting on ${list(detail.waiting_on_epic_ids, 'epic')}${owedText(detail)}`;
        case 'CAPACITY':
            return owedText(detail).replace(/^; /, '');
        case 'ADMITTED':
            return detail.reannounce ? `announced again (attempt ${detail.reannounce})` : '';
        default:
            return Object.keys(detail).sort()
                .map((k) => `${k} ${JSON.stringify(detail[k])}`).join(', ');
    }
}

// A free slot this engine left for a peer on the machine (req #3807's fair share).
const owedText = (detail) => (Array.isArray(detail.owed_to) && detail.owed_to.length
    ? `; the free slot is owed to ${detail.owed_to.join(' and ')}` : '');

/** An event (core.py `_observe`) as one sentence. */
export function eventText(event) {
    if (!event || typeof event !== 'object') return '';
    const words = plainWords(event.code);
    switch (event.code) {
        case 'REGRESSION':
            return `${words}: requirement ${event.requirement_id} on epic ${event.epic_id} went `
                + `${event.from} → ${event.to}`;
        case 'TOP_UP':
            return `${words}: epic ${event.epic_id} gained ${list(event.requirement_ids, 'requirement')}`;
        case 'DRAINED':
            return `${words}${event.since ? ` since ${event.since}` : ''}`;
        case 'LANDED':
            return `${words}: requirement ${event.requirement_id} on epic ${event.epic_id} is `
                + `${event.status}`;
        case 'STALL':
            return `${words}: requirement ${event.requirement_id} on epic ${event.epic_id}`;
        case 'VIOLATION':
            return `${words}: ${event.invariant || 'invariant'}`
                + `${event.message ? ` — ${event.message}` : ''}`;
        case 'CODE_STALE':
            return `${words}${(event.changed || []).length ? `: ${event.changed.join(', ')}` : ''}`;
        default:
            return words;
    }
}
