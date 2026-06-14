// Shared session phase-duration constants (req #2332, extracted req #2825).
//
// Single source of truth for the 8 per-phase `*_secs` buckets on
// `swarm_sessions`: their display labels, agentic/human/machine/legacy grouping,
// and per-phase colors. Consumed by SwarmSessionDetail's phase breakdown and by
// SessionsStatsView's cross-session aggregation so the two never drift on color
// or grouping. Phase grouping is canonical per CLAUDE.md:
//   agentic = planning + implementing + completion
//   human   = waiting + review + paused
//   machine = starting
//   legacy  = legacy_secs (instrumented=0 sessions only)

export const PHASE_BUCKETS = [
    { key: 'starting_secs',      label: 'Starting',      group: 'machine', color: '#5c6bc0' },
    { key: 'waiting_secs',       label: 'Waiting',       group: 'human',   color: '#ffb74d' },
    { key: 'planning_secs',      label: 'Planning',      group: 'agentic', color: '#4fc3f7' },
    { key: 'implementing_secs',  label: 'Implementing',  group: 'agentic', color: '#4caf50' },
    { key: 'review_secs',        label: 'Review',        group: 'human',   color: '#ce93d8' },
    { key: 'completion_secs',    label: 'Completion',    group: 'agentic', color: '#8d6e63' },
    { key: 'paused_secs',        label: 'Paused',        group: 'human',   color: '#f0d000' },
    { key: 'legacy_secs',        label: 'Legacy',        group: 'legacy',  color: '#bdbdbd' },
];

export const GROUP_COLORS = {
    agentic: '#4fc3f7',
    human:   '#ffb74d',
    machine: '#90caf9',
    legacy:  '#bdbdbd',
};

// --- Per-phase TOKEN consumption (req #2839) ---------------------------------
// The token engine (db.py / migration 060) stores a `phase_tokens` JSON column on
// swarm_sessions whose keys mirror the *_secs phase set with the suffix stripped:
//   { "<phase>": { input, cache_write, cache_read, output }, ... }
// where <phase> ∈ {starting, waiting, planning, implementing, review,
// completion, paused}. These helpers map a PHASE_BUCKETS `*_secs` key to its
// token-phase key and surface a single COST figure (the sum of the four
// differently-priced token types).

export const TOKEN_TYPES = ['input', 'cache_write', 'cache_read', 'output'];

// PHASE_BUCKETS key (e.g. 'implementing_secs') → phase_tokens key ('implementing').
export const tokenPhaseKey = (bucketKey) => bucketKey.replace(/_secs$/, '');

// Tolerant parse of the phase_tokens column: the MCP layer may hand it back as a
// JSON string (default for JSON columns) or an already-decoded object. Returns an
// object (possibly empty) — never throws. Mirrors how the telemetry column is
// consumed elsewhere.
export function parsePhaseTokens(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        try {
            const parsed = JSON.parse(trimmed);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

// Sum the four token types in one phase's {input,cache_write,cache_read,output}
// blob into a single cost figure. Missing/garbage fields count as 0.
export function sumPhaseTokens(phaseBlob) {
    if (!phaseBlob || typeof phaseBlob !== 'object') return 0;
    return TOKEN_TYPES.reduce((s, t) => s + (Number(phaseBlob[t]) || 0), 0);
}

// Total tokens for a single PHASE_BUCKETS bucket on one parsed phase_tokens object.
export const bucketTokens = (parsedTokens, bucketKey) =>
    sumPhaseTokens(parsedTokens && parsedTokens[tokenPhaseKey(bucketKey)]);

// Whole-session token cost (req #2846): the sum of all four token types across
// EVERY phase in a session's phase_tokens blob. This is the single figure the
// swarm visualizer scales beads by and the datacard reports. Returns 0 for a
// session with no/garbage token instrumentation (phase_tokens NULL) — same
// convention as sumPhaseTokens. Iterates phase_tokens' own keys (not the *_secs
// bucket list) so any phase the engine emits is counted.
export function sessionTokenCost(session) {
    const parsed = parsePhaseTokens(session && session.phase_tokens);
    if (!parsed) return 0;
    let total = 0;
    for (const phase of Object.keys(parsed)) total += sumPhaseTokens(parsed[phase]);
    return total;
}

// Compact token formatter shared by the swarm views (12.3M / 45.6k / 789 / —).
export const formatTokens = (v) => {
    if (v == null) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return n.toLocaleString();
};
