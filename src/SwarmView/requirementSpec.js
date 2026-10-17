// Requirement SPEC CODES (req #3573) — a five-letter shorthand for the four
// launch fields of a requirement, read left to right:
//
//   SR  I  O  H   =  Swarm-Ready · Implemented · Opus · High   (THE default)
//   SR  I  S  M   =  Swarm-Ready · Implemented · Sonnet · Medium (a cheaper spec)
//
//   pos 1-2  requirement_status   AU authoring · AP approved · SR swarm_ready ·
//                                 DV development · MT met · DF deferred · WF wontfix
//   pos 3    coordination_type    C discuss · P planned · I implemented · D deployed
//   pos 4    ai_model             H haiku · S sonnet · O opus · F fable
//   pos 5    effort               L low · M medium · H high · X xhigh · U ultracode
//
// Fixed width and positional, so the same letter may mean different things in
// different slots (H = haiku in slot 4, high in slot 5). Parsing is
// case-insensitive; the canonical form is upper case.
//
// `discuss` is C (Conversation) because D belongs to `deployed`, the far more
// common choice — SRDOH reads as "ship it", which is what it means.
//
// MIRRORED in darwin-mcp/services/requirement_spec.py — the MCP daemon cannot
// import browser code, so the two tables are kept identical by hand and each
// side's tests pin the same letters.

export const STATUS_CODES = {
    authoring:   'AU',
    approved:    'AP',
    swarm_ready: 'SR',
    development: 'DV',
    met:         'MT',
    deferred:    'DF',
    wontfix:     'WF',
};

export const COORDINATION_CODES = {
    discuss:     'C',
    planned:     'P',
    implemented: 'I',
    deployed:    'D',
};

export const MODEL_CODES = {
    haiku:  'H',
    sonnet: 'S',
    opus:   'O',
    fable:  'F',
};

export const EFFORT_CODES = {
    low:       'L',
    medium:    'M',
    high:      'H',
    xhigh:     'X',
    ultracode: 'U',
};

// THE default requirement: SRIOH. Every create path spreads this rather than
// spelling out its own four literals.
export const DEFAULT_REQUIREMENT_SPEC = Object.freeze({
    requirement_status: 'swarm_ready',
    coordination_type:  'implemented',
    ai_model:           'opus',
    effort:             'high',
});

const invert = (codes) => Object.fromEntries(Object.entries(codes).map(([k, v]) => [v, k]));
const STATUS_BY_CODE = invert(STATUS_CODES);
const COORDINATION_BY_CODE = invert(COORDINATION_CODES);
const MODEL_BY_CODE = invert(MODEL_CODES);
const EFFORT_BY_CODE = invert(EFFORT_CODES);

// Code for a requirement row. A field that is missing or unknown renders as
// '?' rather than borrowing the default, so a code never claims a value the
// row does not hold.
export const specCode = (req) => [
    STATUS_CODES[req?.requirement_status] || '??',
    COORDINATION_CODES[req?.coordination_type] || '?',
    MODEL_CODES[req?.ai_model] || '?',
    EFFORT_CODES[req?.effort] || '?',
].join('');

// Parse a code into the four fields, or null when it is not a valid code.
export const parseSpecCode = (code) => {
    if (typeof code !== 'string') return null;
    const c = code.trim().toUpperCase();
    if (c.length !== 5) return null;
    const spec = {
        requirement_status: STATUS_BY_CODE[c.slice(0, 2)],
        coordination_type:  COORDINATION_BY_CODE[c[2]],
        ai_model:           MODEL_BY_CODE[c[3]],
        effort:             EFFORT_BY_CODE[c[4]],
    };
    return Object.values(spec).every(Boolean) ? spec : null;
};

// Long-form reading of a code, e.g. "Swarm Ready · Implemented · Opus · High".
const words = (s) => s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
export const specLabel = (spec) => spec
    ? [spec.requirement_status, spec.coordination_type, spec.ai_model, spec.effort]
        .map(v => (v ? words(v) : '?')).join(' · ')
    : '';
