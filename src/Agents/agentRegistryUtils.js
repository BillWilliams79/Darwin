// Shared helpers for the agents registry views (req #2998).
//
// The registry is five tables — agents, instructions, architecture_documents,
// and the two junctions that relate them. Lambda-Rest has no join capability, so
// every view fetches the flat tables and relates them HERE. These helpers are the
// single place that relationship logic lives, so /agents, /agents/:id,
// /agents/instructions, and /agents/documents all agree.

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
 */
export const AGENT_MODEL_COLOR = {
    haiku:  '#ffcc80',
    sonnet: '#80cbc4',
    opus:   '#9fa8da',
    fable:  '#ef9a9a',
};

export const agentModelLabel = (m) => m || '—';

export const agentModelChipProps = (m) => {
    const base = (m || '').split('[')[0];        // 'opus[1m]' -> 'opus'
    return { sx: { bgcolor: AGENT_MODEL_COLOR[base] || AGENT_MODEL_COLOR.opus, color: '#000' } };
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
