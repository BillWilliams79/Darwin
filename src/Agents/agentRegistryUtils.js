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
//
// `principles` (req #3129) marks THE ONE document carrying an agent's guiding
// principles. It sorts FIRST because precedence follows load order: the agent
// reads its principles, then its instructions, then its documents. At most one
// link per AGENT may carry it — the mirror image of the one-'owned'-per-DOCUMENT
// rule, enforced by uq_agent_documents_principles.
export const RELATIONSHIP_ORDER = [
    'principles', 'owned', 'curated', 'autoload', 'referenced',
];

// Comma-joined SET string -> array of roles, in precedence order.
export const parseRoles = (rel) => {
    const present = new Set((rel || '').split(',').map(s => s.trim()).filter(Boolean));
    return RELATIONSHIP_ORDER.filter(r => present.has(r));
};

export const hasRole = (rel, role) => parseRoles(rel).includes(role);
export const isAutoload = (rel) => hasRole(rel, 'autoload');
export const isPrinciples = (rel) => hasRole(rel, 'principles');

/**
 * SUPERSEDED ROLES, dropped: the precedence rules of instruction #83, as data.
 *
 * `referenced` means "may consult on demand". `owned` and `principles` both mean
 * the agent reads the document as a matter of course, so either of them already
 * OUTRANKS a reference — a link carrying both ends of that comparison makes the
 * precedence rule refer to itself, which is why `relationshipSetError` blocks the
 * combination outright.
 *
 * WHY THIS IS A TABLE AND NOT AN `if` AT A CALL SITE (req #3101, closing finding
 * 3b from req #3051's review). The invariant used to be enforced in exactly one
 * place — `planOwnerTransfer` filtered `referenced` out before adding `owned` —
 * and it got there only because the FIRST version of that function shipped the
 * invalid combination and had to be corrected. One call site is one chance to
 * forget, and there was nothing stopping the second call site from making the
 * same mistake the first one already made once.
 */
const SUPERSEDES = {
    owned: ['referenced'],
    principles: ['referenced'],
};

/**
 * Drop every role that another role in the same set already outranks.
 *
 * PURE and ORDER-INDEPENDENT: the result depends only on which roles are present,
 * never on the order they arrive in.
 *
 * This function does not drop unknown members — that is `serializeRoles`' job, and
 * doing it in two places would make neither the authority. **But that is only
 * observable on the ARRAY form.** A string argument goes through `parseRoles`
 * first, which keeps only members in `RELATIONSHIP_ORDER`, so `'owned,nonsense'`
 * arrives here already filtered while `['owned', 'nonsense']` does not. The
 * asymmetry is inherited from the parse, not decided here, and it does not reach
 * the database either way.
 */
export const resolveRoleConflicts = (roles = []) => {
    const list = Array.isArray(roles) ? roles : parseRoles(roles);
    const present = new Set(list.map(r => (r || '').trim()).filter(Boolean));
    const dropped = new Set();
    for (const [winner, losers] of Object.entries(SUPERSEDES)) {
        if (!present.has(winner)) continue;
        for (const loser of losers) dropped.add(loser);
    }
    return [...present].filter(r => !dropped.has(r));
};

/**
 * The INVERSE of `parseRoles`: roles -> the exact string the database stores.
 *
 * Deliberately named as `parseRoles`' pair and defined next to it, because the
 * one thing that must never happen on this junction is a round trip through
 * `relationshipLabel`. That helper joins with `", "` for DISPLAY; the space makes
 * `" autoload"` a member no SET recognises, and under the non-strict sql_mode
 * this database runs, an unrecognised member does not raise — the WHOLE
 * assignment stores as `''`. The link then carries no roles at all: not owned,
 * not autoloaded, rendered as an unremarkable dash. A document silently loses its
 * owner and an agent silently stops reading a file it was told to read in full.
 *
 * So: bare comma, no space, unknown members dropped, output in precedence order
 * so two links with the same roles always store byte-identical strings.
 *
 * AND SUPERSEDED MEMBERS DROPPED (req #3101). This is the same job as dropping an
 * unknown member, not a new one: both answer "what does the database actually
 * store for this set?", and both have to be settled at the ONE boundary every
 * junction write crosses — `linkRow` in documentsApi.js serializes here, so no
 * caller can route around it. It does not make `relationshipSetError` redundant
 * and does not weaken it: the validator still refuses the combination on the raw
 * set the USER composed, out loud, in the popover. The serializer is the last
 * line, for sets nobody typed — a transfer plan, an MCP-written row read back,
 * a future call site that has not been written yet.
 */
export const serializeRoles = (roles = []) => {
    const list = Array.isArray(roles) ? roles : parseRoles(roles);
    const present = new Set(resolveRoleConflicts(list));
    return RELATIONSHIP_ORDER.filter(r => present.has(r)).join(',');
};

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
        case 'principles': return { color: 'secondary', variant: 'filled' };
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
 *
 * THE SCHEME IS CHECKED HERE, AT THE RENDER BOUNDARY, and not only in
 * `documentUrlError` on the way in (req #3051). Two reasons the input validator
 * is not sufficient on its own:
 *
 *   1. This UI is not the only writer. `update_architecture_document` in the MCP
 *      daemon accepts `url` with no scheme validation at all, and rows predate
 *      both. A value already in the database has never been past
 *      `documentUrlError`.
 *   2. Rendering is where the harm happens. Every consumer feeds this result
 *      straight into an anchor `href` — DocumentsPage's open-link button and
 *      AgentDetail's document link — and React does NOT sanitize a
 *      `javascript:` URL, it only warns in development. So a stored one would be
 *      a script that runs on click, for every viewer, in production.
 *
 * A rejected scheme FALLS THROUGH to the constructed blob URL rather than
 * returning null: the row still links somewhere true, and the document does not
 * silently lose its only affordance because one column is malformed.
 */
const SAFE_HREF_SCHEME = /^(https?:)?\/\//i;

const isSafeHref = (url) => {
    const trimmed = (url || '').trim();
    if (!trimmed) return false;
    // A value carrying no scheme at all is a relative path: same-origin, inert.
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
    if (!scheme) return true;
    return SAFE_HREF_SCHEME.test(trimmed) || /^https?:$/i.test(scheme[1] + ':');
};

export const documentBlobHref = (location) => (
    (location || '').trim()
        ? `https://github.com/BillWilliams79/DarwinAI-Config/blob/main/${location.trim()}`
        : null);

/**
 * DELEGATES to `documentTarget` (req #3101) rather than restating its precedence.
 *
 * The two used to be independent implementations of one rule, which is a standing
 * invitation to drift — and drift here does not fail, it MISLABELS: `documentTarget`
 * decides which chip the card draws as "the one that opens" while this decides
 * where the button actually goes. One derivation, one answer.
 */
export const documentHref = (doc) => documentTarget(doc).href;

/**
 * WHAT THIS ROW POINTS AT — the whole answer, in one pure function (req #3101, § 2).
 *
 * An `architecture_documents` row is a REGISTRATION, not a file. It records a
 * repo-relative `location` on disk and/or an external `url`, and Darwin never
 * touches either: nothing opens the path, nothing fetches the URL, and deleting
 * the row deletes neither. A typo in `location` is discovered when an agent fails
 * to read it at boot — which it does silently, because the executor is an LLM.
 *
 * Until #3101 that distinction lived only in the DELETE and LOCATION dialogs'
 * copy: invisible on the resting card, and therefore invisible to everybody who
 * was not already in the middle of a destructive action. The card now renders it
 * (DocumentTargetChips) and this is the derivation behind it.
 *
 * THIS IS ALSO THE ONE PLACE THE OPEN-LINK PRECEDENCE IS DECIDED. `documentHref`
 * is `documentTarget(doc).href` — it used to be a second implementation of the same
 * rule, which is a standing invitation to drift, and drift here would not fail, it
 * would MISLABEL: this decides which chip the card draws as "the one that opens"
 * while `documentHref` decides where the button actually goes.
 *
 * `urlRejected` is what the card gained beyond a bare href. The precedence
 * deliberately FALLS THROUGH to the constructed blob URL when a stored `url` fails
 * the scheme guard, so the row keeps a working link — but that fallback is
 * completely silent, and a row whose `url` column is unusable looked identical to
 * a row that never had one. Somebody has to be told, and the card is where they
 * are looking.
 *
 * @returns {{
 *   hasLocation: boolean, hasUrl: boolean,
 *   urlUsable: boolean, urlRejected: boolean,
 *   opens: 'url'|'path'|null, href: string|null, blobHref: string|null,
 * }}
 */
export const documentTarget = (doc) => {
    const location = (doc?.location || '').trim();
    const url = (doc?.url || '').trim();
    const hasLocation = !!location;
    const hasUrl = !!url;
    const urlUsable = hasUrl && isSafeHref(url);
    const blobHref = documentBlobHref(location);

    // THE precedence rule — a stored, usable `url` wins; otherwise the path, as a
    // constructed blob URL. `documentHref` delegates here rather than restating it,
    // so the chip labelled "opens" and the button's destination cannot disagree.
    const opens = urlUsable ? 'url' : (blobHref ? 'path' : null);

    return {
        hasLocation,
        hasUrl,
        urlUsable,
        urlRejected: hasUrl && !urlUsable,
        opens,
        href: opens === 'url' ? url : blobHref,
        blobHref,
    };
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

// ---------------------------------------------------------------------------
// Field validation for edit-in-place DOCUMENT rows (req #3051).
//
// Same contract as the instruction validators above — a pure function per field
// returning an error string or null — and the same reason for existing: the RDS
// sql_mode is NOT strict, so the database silently TRUNCATES an over-long value
// and silently CLAMPS an out-of-range integer instead of rejecting it. The client
// is the only guard.
//
// TWO WAYS THIS DIFFERS FROM THE INSTRUCTION SIDE, both verified against
// DarwinSQL/schema.sql rather than assumed:
//
//   1. EVERY editable document column is a VARCHAR, not a TEXT. MySQL measures a
//      VARCHAR in CHARACTERS and a TEXT in BYTES — so `contentByteLength` (right
//      for instructions.content) is the WRONG measure here, and so is JS
//      `String.length`, which counts UTF-16 code units and reads an emoji as 2
//      where MySQL counts 1. Rejecting a legal name is as much a defect as
//      accepting an illegal one. See `charLength`.
//
//   2. `doc_type` LOOKS like an enum and is not: the column is VARCHAR(16) with a
//      default, and VALID_DOC_TYPES is enforced only inside the MCP daemon
//      (darwin-mcp/services/agents.py). A browser POST of "mrkdown" is accepted,
//      stored, and then renders as an ordinary chip — nothing anywhere catches it.
//      That is why the UI offers a fixed choice rather than a free-text field, and
//      why this validator exists behind it.
// ---------------------------------------------------------------------------

// VARCHAR widths, from DarwinSQL/schema.sql.
export const DOCUMENT_NAME_MAX = 256;       // NOT NULL, UNIQUE
export const DOCUMENT_LOCATION_MAX = 512;   // nullable
export const DOCUMENT_URL_MAX = 1024;       // nullable
export const DOCUMENT_NOTES_MAX = 512;      // agent_documents.notes, nullable

/** The only three values the registry recognises (MCP `VALID_DOC_TYPES`). */
export const DOC_TYPES = ['markdown', 'html', 'text'];

/**
 * Length as MySQL counts it for a utf8mb4 VARCHAR: CODE POINTS.
 *
 * `'x'.length` counts UTF-16 code units, so any astral character (an emoji, and
 * plenty of CJK extensions) counts double and a legal value would be rejected.
 * Spreading the string iterates code points, which is what utf8mb4 stores one
 * character per.
 */
export const charLength = (text) => [...(text || '')].length;

/**
 * Is this document name already taken?
 *
 * `architecture_documents.name` carries UNIQUE `uq_architecture_documents_name`,
 * and — exactly like the instruction key — it does NOT exclude closed rows. The
 * check must therefore run against the UNFILTERED catalog: the page hides closed
 * rows by default, so colliding with one is a rejection the user cannot see the
 * cause of. Compared case-insensitively on the trimmed value, matching the
 * server's default utf8mb4 collation.
 */
export const documentNameTaken = (name, documents = [], selfId = null) => {
    const candidate = (name || '').trim().toLowerCase();
    if (!candidate) return false;
    return documents.some(
        d => d.id !== selfId && (d.name || '').trim().toLowerCase() === candidate);
};

/**
 * Verdict for a pending document `name`.
 *
 * Empty is NOT an error, for the same reason as `instructionNameError`: the
 * column is NOT NULL, so an in-place field treats empty as "abandon the edit" and
 * reverts. Reporting it would leave a red field the user can only clear by
 * retyping what was already there.
 */
export const documentNameError = (name, documents = [], selfId = null) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const len = charLength(trimmed);
    if (len > DOCUMENT_NAME_MAX) {
        return `Too long: ${len} of ${DOCUMENT_NAME_MAX} characters. `
            + 'The database would truncate it silently.';
    }
    if (documentNameTaken(trimmed, documents, selfId)) {
        return `A document named "${trimmed}" already exists (it may be closed).`;
    }
    return null;
};

/**
 * Verdict for `location` — the repo-relative path of the file this row registers.
 *
 * THIS IS THE MOST DANGEROUS FIELD ON THE PAGE, which is the opposite of how it
 * looks. `name` is UNIQUE and reads like a key, but nothing in production
 * resolves a document by name (`get_architecture_document_by_name` exists and has
 * no caller outside the MCP test suite). `location` reads like a caption and is
 * live, executed data: instruction #83 orders all 12 agents to read every
 * `autoload` document "from its `location` in full, byte 1 to byte n" before
 * starting work. The executor is an LLM, not a function, so nothing type-checks
 * it — a wrong path means the agent boots without knowledge it was told to have
 * and reports itself green. The only detector is the context-telemetry harness,
 * and that walks `autoload_documents` only.
 *
 * The client cannot verify a path exists — the browser has no filesystem. So
 * validation here is limited to shapes that are definitely wrong, and the real
 * guard is the confirmation the page requires before writing this field on a
 * document any agent autoloads.
 *
 * Empty is not an error: the column is nullable, and a row with only a `url` is
 * legal (`documentHref` prefers `url` anyway).
 */
export const documentLocationError = (location) => {
    const trimmed = (location || '').trim();
    if (!trimmed) return null;
    const len = charLength(trimmed);
    if (len > DOCUMENT_LOCATION_MAX) {
        return `Too long: ${len} of ${DOCUMENT_LOCATION_MAX} characters. `
            + 'The database would truncate it silently.';
    }
    // `documentHref` interpolates this straight into a GitHub blob URL when `url`
    // is absent, and every one of the 69 live rows is repo-relative.
    if (trimmed.startsWith('/')) {
        return 'Repo-relative path, with no leading slash (e.g. "memory/foo.md").';
    }
    if (trimmed.includes('..')) {
        return 'A path segment of ".." cannot be resolved from the repo root.';
    }
    if (/\s/.test(trimmed)) {
        return 'A path with whitespace in it will not resolve — check for a stray space.';
    }
    return null;
};

/**
 * Verdict for `url`.
 *
 * Length is the boring half. The SCHEME check is the real one: `documentHref`
 * returns `doc.url` verbatim and the page renders it straight into an anchor
 * `href`. While the column was read-only that was inert — the only writer was a
 * seed script. Making the field editable turns it into a stored-href sink, so a
 * `javascript:` (or `data:`) value would be a script that runs on click, stored
 * in the database, for every viewer. Restricting the scheme to http/https is the
 * cheapest correct guard and costs nothing real: every one of the 69 live rows is
 * an https GitHub-blob or site URL.
 *
 * A path with no scheme is allowed through — `documentHref` prefers `url` when
 * present, and a relative href is same-origin and harmless.
 */
export const documentUrlError = (url) => {
    const trimmed = (url || '').trim();
    if (!trimmed) return null;
    const len = charLength(trimmed);
    if (len > DOCUMENT_URL_MAX) {
        return `Too long: ${len} of ${DOCUMENT_URL_MAX} characters. `
            + 'The database would truncate it silently.';
    }
    // Only a value that actually carries a scheme is scheme-checked; anything
    // else is a relative path. The pattern matches the RFC 3986 shape rather than
    // hunting for "javascript:" so a novel scheme is refused by default.
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
    if (scheme && !/^https?$/i.test(scheme[1])) {
        return `Only http and https links are allowed here (this is "${scheme[1]}:"). `
            + 'The registry renders this value straight into a link.';
    }
    return null;
};

/** Verdict for a link's `notes` — free prose about why an agent holds a role. */
export const documentNotesError = (notes) => {
    const len = charLength(notes || '');
    if (len > DOCUMENT_NOTES_MAX) {
        return `Too long: ${len} of ${DOCUMENT_NOTES_MAX} characters. `
            + 'The database would truncate it silently.';
    }
    return null;
};

/** Verdict for `doc_type`. The column is free text; this is the only guard. */
export const docTypeError = (docType) => (
    DOC_TYPES.includes(docType)
        ? null
        : `Unknown document type "${docType}". Must be one of: ${DOC_TYPES.join(', ')}.`);

/**
 * Verdict for a pending role set. Error string, or null when writable.
 *
 * An EMPTY set is an error here rather than a revert, and that is deliberate —
 * the opposite call from the text fields above. `relationship` is NOT NULL, but
 * `''` is a perfectly legal value for a NOT NULL SET column, so the database
 * would accept it and the link would simply stop meaning anything. There is no
 * stored value to fall back to either: the roles ARE the link.
 */
export const relationshipSetError = (roles = []) => {
    const list = Array.isArray(roles) ? roles : parseRoles(roles);
    const unknown = list.filter(r => !RELATIONSHIP_ORDER.includes((r || '').trim()));
    if (unknown.length) {
        return `Unknown relationship${unknown.length === 1 ? '' : 's'}: `
            + `${unknown.join(', ')}. Must be one of: ${RELATIONSHIP_ORDER.join(', ')}.`;
    }
    if (!serializeRoles(list)) {
        return 'A link must carry at least one role — remove the link instead.';
    }
    // Instruction #83 makes an `owned` or `curated` document outrank a
    // `referenced` one. A link carrying both ends of that comparison makes the
    // precedence rule refer to itself, so it is a hard block rather than a hint.
    if (list.includes('owned') && list.includes('referenced')) {
        return 'A link cannot be both owned and referenced — owning already outranks referencing.';
    }
    // req #3129: a guiding-principles document is read at boot by definition, so
    // `principles` without `autoload` is a link that says "read this first" and
    // "read this on demand" at the same time. The two roles are carried together
    // deliberately — `principles` does not imply `autoload` in code, precisely so
    // that every existing autoload consumer keeps working unchanged.
    if (list.includes('principles') && !list.includes('autoload')) {
        return 'A principles document must also be autoload — it is read at boot by definition.';
    }
    if (list.includes('principles') && list.includes('referenced')) {
        return 'A link cannot be both principles and referenced — principles outranks every other role.';
    }
    return null;
};

/**
 * Advisory for a role set — never blocks. Owning a document already carries the
 * duty to keep it accurate (instruction #83), so `curated` on top of `owned`
 * states the same thing twice rather than contradicting it.
 */
export const relationshipSetHint = (roles = []) => {
    const list = Array.isArray(roles) ? roles : parseRoles(roles);
    if (list.includes('owned') && list.includes('curated')) {
        return 'Redundant: owning a document already carries the duty to keep it accurate.';
    }
    return null;
};

/**
 * Which agent currently holds `owned` on this document, if any.
 * Returns the junction link, not the agent row.
 */
export const documentOwnerLink = (links = []) =>
    links.find(l => hasRole(l.relationship, 'owned')) || null;

/**
 * Next free slot in an agent's per-agent DOCUMENT order — max + 1, 1-indexed.
 *
 * Peer to `nextInstructionSortOrder`. `agent_documents.sort_order` is a tiebreak
 * WITHIN a relationship rank (`list_documents_for_agent` orders by rank, then
 * this, then name), so it matters less than the instruction one — but a new link
 * landing on NULL still sorts last regardless of its role, which is wrong for a
 * document an agent just took ownership of.
 */
export const nextDocumentSortOrder = (agentId, docLinks) => {
    const links = docLinks.get(agentId) || [];
    const orders = links.map(l => l.sort_order).filter(o => Number.isFinite(o));
    return orders.length ? Math.max(...orders) + 1 : 1;
};

/**
 * Plan the writes that move `owned` on one document from one agent to another.
 *
 * PURE — it issues nothing. That is the point: ownership transfer is the one
 * multi-write action on this page, the dialog has to describe the exact writes
 * before the user authorizes them, and the whole thing has to be testable without
 * a network.
 *
 * THE ORDER IS FORCED, NOT CHOSEN. `uq_agent_documents_owner` is a UNIQUE key
 * over a VIRTUAL column that equals `document_fk` exactly when the SET contains
 * `owned`. So the incoming claim is rejected while the incumbent still holds it:
 * release must come first, and the window in which the document is unowned is
 * structural. Only its LENGTH and its RECOVERABILITY are in our control — hence
 * `prev` on every step, which is what `applyLinkPlan` rolls back with.
 *
 * The incumbent KEEPS its other roles. An `owned,autoload` owner handing over
 * ownership becomes plain `autoload` — it very likely still reads the file at
 * boot, and silently dropping that would be a second change nobody asked for.
 * When `owned` was its ONLY role there is no link left to demote to, so
 * `keepOutgoing` decides between removing the link and parking it at
 * `referenced`. Parking is the default the dialog offers, because the link's
 * `notes` die with it and 87 of the 100 live links carry one.
 *
 * @param documentId   the document being transferred
 * @param fromLink     the incumbent owner's link, or null when unowned
 * @param toLink       the incoming owner's existing link, or null
 * @param toAgentId    the incoming owner, or null to RELEASE without a successor
 * @param keepOutgoing when the outgoing link would be left roleless, park it at
 *                     `referenced` instead of deleting it
 * @returns ordered steps of `{ agent_fk, document_fk, prev, next }`
 */
export const planOwnerTransfer = ({
    documentId, fromLink = null, toLink = null, toAgentId = null, keepOutgoing = true,
}) => {
    const steps = [];

    if (fromLink) {
        const remaining = parseRoles(fromLink.relationship).filter(r => r !== 'owned');
        const nextRoles = remaining.length
            ? serializeRoles(remaining)
            : (keepOutgoing ? 'referenced' : '');
        steps.push({
            agent_fk: fromLink.agent_fk,
            document_fk: documentId,
            prev: fromLink,
            // EVERY column of the row is carried forward. There is no PUT on this
            // table, so a "role change" is a DELETE and a fresh INSERT — and an
            // INSERT that omits `notes` or `sort_order` does not leave them alone,
            // it writes NULL over them. That is the quietest way to lose data on
            // this page.
            next: nextRoles
                ? { ...fromLink, relationship: nextRoles }
                : null,
        });
    }

    if (toAgentId != null) {
        // `owned` SUPERSEDES `referenced`; it does not stack with it. A blind
        // union would therefore produce a set this codebase itself rejects:
        // claiming ownership of a document you currently merely reference (the
        // single commonest transfer target, since all 32 non-owner links are plain
        // `referenced`) would build an invalid plan. `autoload` and `curated` are
        // orthogonal to ownership and are kept.
        //
        // THAT RULE IS NO LONGER APPLIED HERE (req #3101). It lives in
        // `resolveRoleConflicts`, which `serializeRoles` runs on every set on its
        // way to the wire — so this call site gets it for free and, more to the
        // point, so does every call site written after this one. This function was
        // where the invariant was enforced and where the first version of it was
        // got WRONG; a rule holding in exactly one place is a rule waiting to be
        // forgotten in the second.
        const merged = serializeRoles([
            ...parseRoles(toLink?.relationship),
            'owned',
        ]);
        steps.push({
            agent_fk: toAgentId,
            document_fk: documentId,
            prev: toLink,
            next: {
                ...(toLink || {}),
                agent_fk: toAgentId,
                document_fk: documentId,
                relationship: merged,
            },
        });
    }

    return steps;
};

/**
 * Turn a thrown call_rest_api rejection into something a human can act on.
 *
 * Lambda-Rest answers a constraint violation with HTTP 409 and a structured body
 * (req #3059): `{ error, errno, constraint, table, message }`. call_rest_api
 * parks that object on `err.httpStatus.httpDetail`, so the constraint that
 * actually failed is a field read rather than a regex against pymysql prose —
 * which could not reliably tell "you picked a taken name" from "the database is
 * broken" (the reason this function originally had to guess from message text,
 * before #3059 gave every table a real status code).
 *
 * Anything that is NOT a 409 falls through to `fallback` on purpose: a 500 means
 * the database is genuinely unhappy and "that name is taken" would be a lie.
 *
 * `constraint` arrives UNQUALIFIED (`PRIMARY`, not `agent_instructions.PRIMARY`),
 * so every junction check pairs it with `table` — every table has a `PRIMARY`,
 * and `agent_instructions.PRIMARY` / `agent_documents.PRIMARY` would otherwise be
 * indistinguishable the way their old regex forms had to be qualified to avoid.
 */
export const restErrorMessage = (err, fallback) => {
    if (err?.httpStatus?.httpStatus !== 409) return fallback;
    const { errno, constraint, table } = err.httpStatus.httpDetail || {};

    if (errno === 1062 && constraint === 'uq_instructions_name') {
        return 'That instruction name is already in use (the existing row may be closed).';
    }
    if (errno === 1062 && constraint === 'PRIMARY' && table === 'agent_instructions') {
        return 'That instruction is already bound to this agent.';
    }
    // req #3075, migration 073: UNIQUE (agent_fk, sort_order). Matched SEPARATELY
    // from the PRIMARY case above even though both are 1062 on the same table —
    // "already bound" and "that load position is taken" are different problems
    // with different fixes, and collapsing them would send the reader to the
    // wrong one. Reachable from two paths: binding a new instruction at a slot
    // another already holds, and a reorder whose re-POST lands on a slot it did
    // not first vacate.
    if (errno === 1062 && constraint === 'uq_agent_instructions_slot') {
        return 'Another instruction already holds that load-order slot for this '
            + 'agent. Reload the page and retry — the list may have moved since '
            + 'it was drawn.';
    }
    // req #3051 — the documents registry's three keys.
    if (errno === 1062 && constraint === 'uq_architecture_documents_name') {
        return 'A document with that name already exists (the existing row may be closed).';
    }
    // The unique key is over the VIRTUAL `owned_document_fk`, so this fires only
    // on a SECOND ownership claim — never on an ordinary link.
    if (errno === 1062 && constraint === 'uq_agent_documents_owner') {
        return 'Another agent already owns this document — at most one owner per document. '
            + 'Use "curated" for a second architect, or hand ownership over from the current owner.';
    }
    if (errno === 1062 && constraint === 'PRIMARY' && table === 'agent_documents') {
        return 'That document is already linked to this agent.';
    }
    if (errno === 1451 || errno === 1452) {
        return 'The agent, instruction or document no longer exists — reload the page and retry.';
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
