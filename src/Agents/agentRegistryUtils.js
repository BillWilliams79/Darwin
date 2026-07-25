// Shared helpers for the agents registry views (req #2998).
//
// The registry is five tables — agents, instructions, architecture_documents,
// and the two junctions that relate them. Lambda-Rest has no join capability, so
// every view fetches the flat tables and relates them HERE. These helpers are the
// single place that relationship logic lives, so /agents, /agents/:id,
// /agents/instructions, and /agents/documents all agree.

import { AI_MODEL_COLOR, modelFillColor } from '../SwarmView/modelChipStyles';

// Relationship roles (req #3012). `relationship` is now a MySQL SET, so a link
// may carry several roles at once (e.g. "owned,autoload") and REST returns them
// as a comma-joined string. These helpers parse that string. `autoload` is the
// role marking a document the agent reads IN FULL at boot — stored, not derived.
export const RELATIONSHIP_ORDER = [
    'owned', 'curated', 'autoload', 'referenced',
];

// Comma-joined SET string -> array of roles, in precedence order.
export const parseRoles = (rel) => {
    const present = new Set((rel || '').split(',').map(s => s.trim()).filter(Boolean));
    return RELATIONSHIP_ORDER.filter(r => present.has(r));
};

export const hasRole = (rel, role) => parseRoles(rel).includes(role);
export const isAutoload = (rel) => hasRole(rel, 'autoload');

// The highest-precedence role present — drives single-chip styling and sorting.
export const primaryRole = (rel) => parseRoles(rel)[0] || null;

export const relationshipRank = (rel) => {
    const i = RELATIONSHIP_ORDER.indexOf(primaryRole(rel));
    return i === -1 ? RELATIONSHIP_ORDER.length : i;
};

// Chip style keyed off the highest-precedence role present. `owned` is filled and
// primary because it is the load-bearing one — at most one per document (DB).
export const relationshipChipProps = (rel) => {
    switch (primaryRole(rel)) {
        case 'owned':      return { color: 'primary', variant: 'filled' };
        case 'curated':    return { color: 'success', variant: 'filled' };
        case 'autoload':   return { color: 'info',    variant: 'outlined' };
        case 'referenced': return { color: 'default', variant: 'outlined' };
        default:           return { color: 'default', variant: 'outlined' };
    }
};

// All roles a link carries, joined — e.g. "owned, autoload".
export const relationshipLabel = (rel) =>
    parseRoles(rel).join(', ') || '—';

/**
 * Model pin display for a registry agent.
 *
 * Deliberately NOT SwarmView's `aiModelLabel`. That helper maps an unknown value
 * onto 'Opus' (the req #2909 backfill default), which would render the standard
 * architect pin `opus[1m]` as a bare "Opus" and silently drop the 1M-context
 * suffix — the exact detail the frontmatter mirror exists to carry. Show the
 * stored value verbatim; only the COLOUR is borrowed from the base model.
 *
 * The colour map IS the base-model palette (single source of truth in
 * modelChipStyles) so agent pins track the red→green ramp automatically and can
 * never drift from it (req #3044). Exported as the raw (dark-mode-equivalent)
 * hex for any external reader that wants it; the chip itself resolves its
 * actual fill through `modelFillColor`, which additionally accounts for
 * `theme.palette.mode` (req #3053) — see that function's doc comment.
 */
export const AGENT_MODEL_COLOR = AI_MODEL_COLOR;

export const agentModelLabel = (m) => m || '—';

export const agentModelChipProps = (m) => {
    const base = (m || '').split('[')[0];        // 'opus[1m]' -> 'opus'
    // req #3053: mode-aware fill — see modelFillColor's doc comment. The
    // light-mode pastel step reads as washed-out/grey on a white card even
    // though the black text on it is independently legible.
    return { sx: (theme) => ({ bgcolor: modelFillColor(base, theme.palette.mode), color: '#000' }) };
};

export const docTypeChipProps = (t) =>
    t === 'html' ? { color: 'info', variant: 'filled' }
                 : { color: 'default', variant: 'outlined' };

/**
 * Resolve the clickable link for a document.
 *
 * `url` is authoritative when present — the seed sets it to the rendered site
 * URL for html docs and the GitHub blob URL for markdown, which is what a reader
 * actually wants. Falling back to a constructed blob URL keeps a hand-inserted
 * row (one created through the MCP tool without a url) clickable rather than
 * dead.
 */
export const documentHref = (doc) => {
    if (doc?.url) return doc.url;
    if (!doc?.location) return null;
    return `https://github.com/BillWilliams79/DarwinAI-Config/blob/main/${doc.location}`;
};

/**
 * Index agent→document links by agent id.
 * Returns Map<agentId, link[]>, each list sorted by relationship precedence
 * then sort_order — the same ordering the MCP payload returns.
 */
export const linksByAgent = (agentDocs = []) => {
    const map = new Map();
    for (const l of agentDocs) {
        if (!map.has(l.agent_fk)) map.set(l.agent_fk, []);
        map.get(l.agent_fk).push(l);
    }
    for (const list of map.values()) {
        list.sort((a, b) =>
            relationshipRank(a.relationship) - relationshipRank(b.relationship) ||
            (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
    }
    return map;
};

/**
 * Index agent→document links by DOCUMENT id — the reverse direction that makes
 * "who owns this file?" answerable from the documents registry (req #2494
 * bidirectional interlinking).
 */
export const linksByDocument = (agentDocs = []) => {
    const map = new Map();
    for (const l of agentDocs) {
        if (!map.has(l.document_fk)) map.set(l.document_fk, []);
        map.get(l.document_fk).push(l);
    }
    for (const list of map.values()) {
        list.sort((a, b) =>
            relationshipRank(a.relationship) - relationshipRank(b.relationship));
    }
    return map;
};

/** Index agent→instruction links by agent id, in junction sort_order (load order). */
export const instructionLinksByAgent = (agentInstructions = []) => {
    const map = new Map();
    for (const l of agentInstructions) {
        if (!map.has(l.agent_fk)) map.set(l.agent_fk, []);
        map.get(l.agent_fk).push(l);
    }
    for (const list of map.values()) {
        list.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
    }
    return map;
};

/** Reverse: which agents reference each instruction — the blast radius of an edit. */
export const agentsByInstruction = (agentInstructions = []) => {
    const map = new Map();
    for (const l of agentInstructions) {
        if (!map.has(l.instruction_fk)) map.set(l.instruction_fk, []);
        map.get(l.instruction_fk).push(l.agent_fk);
    }
    return map;
};

/**
 * An instruction is "common" when more than one agent links it. There is no
 * common flag in the schema — a shared instruction is just a row with many
 * links, which is the whole point of instructions being their own data type.
 */
export const isCommonInstruction = (instructionId, byInstruction, threshold = 2) =>
    (byInstruction.get(instructionId)?.length || 0) >= threshold;

// ---------------------------------------------------------------------------
// Editing helpers (req #3049).
//
// ONE `sort_order` COLUMN NOW, AND IT DRIVES BOOT.
//   agent_instructions.sort_order — the per-(agent, instruction) LOAD ORDER the
//       boot payload uses. This is the one an agent actually feels, and the only
//       one left.
// There used to be a second, `instructions.sort_order`, a CATALOG hint that
// ordered the browse list and nothing else. Keeping the two straight was
// documented here as the likeliest defect in this area — so req #3063 measured
// it (identical on all 78 live rows, and driving nothing once the sort menu
// shipped) and migration 072 dropped it. The helpers below have always operated
// exclusively on the JUNCTION column; now there is nothing else to confuse them
// with.
// ---------------------------------------------------------------------------

/**
 * Next free load-order slot for an agent — max(sort_order) + 1, 1-indexed.
 * Used when binding a new instruction so it lands at the end of the agent's
 * load order rather than colliding with an existing slot.
 */
export const nextInstructionSortOrder = (agentId, instrLinks) => {
    const links = instrLinks.get(agentId) || [];
    const orders = links.map(l => l.sort_order).filter(o => Number.isFinite(o));
    return orders.length ? Math.max(...orders) + 1 : 1;
};

/**
 * Repair a link list's `sort_order` values IN PLACE-PRESERVING fashion.
 *
 * A stored value is KEPT whenever it can be: it must be a finite number, strictly
 * greater than the previous kept/assigned value, and not claimed by a link
 * outside this list. Anything else (NULL, or a value that would duplicate or go
 * backwards) gets the next free slot.
 *
 * This is deliberately NOT a 1..N renumber. The live registry uses BANDED slots:
 * per-agent instructions occupy 1..N, and the shared "common-*" rows sit together
 * at 100, 101, 102 on every architect. Renumbering would collapse both bands into
 * one undifferentiated run, permanently destroying the separation and the gap
 * that keeps it extensible. Keeping good values means a single NULL in the middle
 * repairs to 1, 2, 100 rather than 1, 2, 3.
 *
 * `reserved` carries sort_order values held by links the caller is NOT
 * rewriting — in practice an agent's CLOSED links, which stay in the table and
 * would otherwise collide with a repaired value.
 */
export const repairInstructionOrders = (links = [], reserved = []) => {
    const taken = new Set(reserved.filter(o => Number.isFinite(o)));
    // Starts below zero so a deliberate 0 or negative slot is KEPT rather than
    // silently rewritten; the assignment path still floors new slots at 1.
    let last = -Infinity;
    return links.map(l => {
        const current = l.sort_order;
        if (Number.isFinite(current) && current > last && !taken.has(current)) {
            last = current;
            return l;
        }
        let next = Math.max(last, 0) + 1;
        while (taken.has(next)) next += 1;
        last = next;
        return { ...l, sort_order: next };
    });
};

/**
 * Plan a load-order move as a SWAP of two rows' sort_order values.
 *
 * Why a swap and not a renumber: see repairInstructionOrders. A swap preserves
 * the value SET, so the banded slots survive every reorder, and it bounds the
 * blast radius — the write set is the two moved rows plus only those rows a
 * repair genuinely had to touch, never the whole list by default.
 *
 * `links` must be the agent's links already in display order (the order
 * `instructionLinksByAgent` produces: sort_order asc, NULLs last).
 *
 * Returns { writes, originals } — the rows whose stored value actually changes,
 * and the same rows at their PRE-change value for rollback. Returns null when
 * the move is out of bounds or would change nothing.
 */
export const planInstructionSwap = (links = [], fromIdx, toIdx, reserved = []) => {
    if (fromIdx === toIdx) return null;
    if (fromIdx < 0 || toIdx < 0) return null;
    if (fromIdx >= links.length || toIdx >= links.length) return null;

    const repaired = repairInstructionOrders(links, reserved);
    const fromOrder = repaired[fromIdx].sort_order;
    const toOrder = repaired[toIdx].sort_order;

    const final = repaired.map((l, i) => {
        if (i === fromIdx) return { ...l, sort_order: toOrder };
        if (i === toIdx) return { ...l, sort_order: fromOrder };
        return l;
    });

    const writes = [];
    const originals = [];
    final.forEach((l, i) => {
        if (l.sort_order === links[i].sort_order) return;   // untouched — don't write it
        writes.push(l);
        originals.push(links[i]);
    });

    return writes.length ? { writes, originals } : null;
};

/**
 * Is this instruction name already taken?
 *
 * `instructions.name` carries a UNIQUE key that does NOT exclude closed rows, so
 * the check must run against the UNFILTERED catalog — colliding with an
 * invisible closed row is the confusing failure this prevents. Compared
 * case-insensitively on the trimmed value: MySQL's default collation is
 * case-insensitive, so "Foo" and "foo" collide in the database too.
 */
export const instructionNameTaken = (name, instructions = [], selfId = null) => {
    const candidate = (name || '').trim().toLowerCase();
    if (!candidate) return false;
    return instructions.some(
        i => i.id !== selfId && (i.name || '').trim().toLowerCase() === candidate);
};

// ---------------------------------------------------------------------------
// Field validation for edit-in-place instruction rows (req #3063).
//
// These moved out of InstructionEditDialog when the dialog died. A modal could
// afford to gate one Save button on a combined `invalid` boolean; an in-place
// field commits on blur, alone, with no button to disable — so each field needs
// its own verdict, and that verdict has to be a pure function the tests can pin.
//
// EVERY limit here exists because the RDS sql_mode is NOT strict: an over-long
// value is silently TRUNCATED and an out-of-range SMALLINT is silently CLAMPED,
// rather than rejected. For text an agent loads verbatim at boot that is a
// correctness failure, not a cosmetic one, so the client is the only guard.
// ---------------------------------------------------------------------------

// `instructions.name` is VARCHAR(256) with a UNIQUE key.
export const INSTRUCTION_NAME_MAX = 256;

// `instructions.content` is TEXT: 65,535 BYTES (not characters).
export const INSTRUCTION_CONTENT_MAX_BYTES = 65535;

// Long prose belongs in an architecture document. A HINT, never a block — the
// registry's own guidance, not a schema limit.
export const INSTRUCTION_CONTENT_HINT_LENGTH = 1500;

/** Encoded byte length — what MySQL actually measures a TEXT column against. */
export const contentByteLength = (content) =>
    new TextEncoder().encode(content || '').length;

/**
 * Verdict for a pending `name`. Returns an error string, or null when the value
 * may be written.
 *
 * An EMPTY name is not an error here: `name` is NOT NULL, so an in-place field
 * treats empty as "abandon the edit" and reverts to the stored value, exactly as
 * AgentDetail's overview field does. Reporting it as an error would leave a red
 * field the user cannot clear without retyping what was already there.
 */
export const instructionNameError = (name, instructions = [], selfId = null) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    if (trimmed.length > INSTRUCTION_NAME_MAX) {
        return `Too long: ${trimmed.length} of ${INSTRUCTION_NAME_MAX} characters. `
            + 'The database would truncate it silently.';
    }
    if (instructionNameTaken(trimmed, instructions, selfId)) {
        return `An instruction named "${trimmed}" already exists (it may be closed).`;
    }
    return null;
};

/**
 * Verdict for a pending `content`. Error string, or null when writable.
 *
 * Empty is not an error, for the same reason as `name` above — `content` is NOT
 * NULL and an emptied field reverts.
 */
export const instructionContentError = (content) => {
    if (!(content || '').trim()) return null;
    const bytes = contentByteLength(content);
    if (bytes > INSTRUCTION_CONTENT_MAX_BYTES) {
        return `Too long: ${bytes.toLocaleString()} bytes of a `
            + `${INSTRUCTION_CONTENT_MAX_BYTES.toLocaleString()}-byte limit. `
            + 'The database would truncate it silently.';
    }
    return null;
};

/**
 * Turn a thrown call_rest_api rejection into something a human can act on.
 *
 * Lambda-Rest has no 409: a constraint violation arrives as HTTP 500 whose body
 * is the raw pymysql message (`"HTTP PUT SQL FAILED: 1062 Duplicate entry ..."`).
 * Matching on the message is the only way to tell "you picked a taken name" from
 * "the database is broken" — mapping IntegrityError to a real status code is
 * filed as its own requirement.
 */
export const restErrorMessage = (err, fallback) => {
    const msg = typeof err?.httpStatus?.httpMessage === 'string'
        ? err.httpStatus.httpMessage
        : '';

    if (/Duplicate entry .* for key '.*uq_instructions_name'/i.test(msg)) {
        return 'That instruction name is already in use (the existing row may be closed).';
    }
    if (/Duplicate entry .* for key '.*agent_instructions\.PRIMARY'/i.test(msg)) {
        return 'That instruction is already bound to this agent.';
    }
    if (/foreign key constraint fails/i.test(msg)) {
        return 'The agent or instruction no longer exists — reload the page and retry.';
    }
    return fallback;
};

/** Build an id→row lookup for any entity list. */
export const byId = (rows = []) => {
    const m = new Map();
    for (const r of rows) m.set(r.id, r);
    return m;
};

/**
 * Anchor-chip counts for an agent card (req #2494 grammar): "7 instructions ·
 * 9 documents". Returns the parts so the caller can render each as its own
 * drill-through chip.
 */
export const agentCounts = (agentId, instrLinks, docLinks) => {
    const docs = docLinks.get(agentId) || [];
    return {
        instructions: (instrLinks.get(agentId) || []).length,
        documents: docs.length,
        autoload: docs.filter(d => isAutoload(d.relationship)).length,
    };
};
