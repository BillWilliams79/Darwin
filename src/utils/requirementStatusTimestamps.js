// Derives the three requirement status timestamps (started_at, completed_at,
// deferred_at) for a requirement_status transition — the identical rule
// darwin-mcp/services/requirements.py applies server-side (req #3244). Every
// frontend writer of requirement_status must send all three columns on every
// write, so a status change made from the UI leaves the same timestamps a
// change made through MCP leaves. One place to get this right; a third writer
// inherits it by calling in rather than having to remember the rule.

const STATUS_TIMESTAMP_COLUMN = {
    development: 'started_at',
    met: 'completed_at',
    wontfix: 'completed_at',   // terminal, like met (req #2783)
    deferred: 'deferred_at',
};

const TIMESTAMP_COLUMNS = ['started_at', 'completed_at', 'deferred_at'];

// PUT body form — the stamped column gets `now` (ISO string), the other two get
// the literal string 'NULL', Lambda-Rest's REST PUT NULL sentinel that clears a
// column (see RequirementDetail.jsx's machine_fk handling for the same convention).
export function requirementStatusTimestampFields(status, now = new Date().toISOString()) {
    const stamped = STATUS_TIMESTAMP_COLUMN[status];
    const fields = {};
    for (const column of TIMESTAMP_COLUMNS) {
        fields[column] = column === stamped ? now : 'NULL';
    }
    return fields;
}

// Local-state / cache form — same derivation, but a real `null` instead of the
// 'NULL' sentinel, for optimistic React state and TanStack cache updates.
export function requirementStatusTimestampState(status, now = new Date().toISOString()) {
    const stamped = STATUS_TIMESTAMP_COLUMN[status];
    const fields = {};
    for (const column of TIMESTAMP_COLUMNS) {
        fields[column] = column === stamped ? now : null;
    }
    return fields;
}
