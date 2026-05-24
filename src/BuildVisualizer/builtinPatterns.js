// Built-in pattern registry.
//
// Built-ins are code-provided patterns that ALWAYS appear in the saved-pattern
// dropdown, on every load, without any localStorage manipulation. They live in
// the same library as user-saved patterns but have stable IDs prefixed with
// `builtin:` so a code-added entry never collides with a user's Save-As copy
// (those get random `pat-…` ids from `makeId()`).
//
// Adding a new pattern from code: append another entry to `BUILTIN_PATTERNS`
// — it appears in the dropdown the next time the page loads.
//
// Changing an EXISTING pattern's content: bump its `id` (e.g.
// `builtin:sprint-cycle` → `builtin:sprint-cycle-2`). The new id appears as a
// new entry on the user's next load; the old entry is preserved in case they
// customized it. Never silently overwrite a built-in's data — that would
// clobber any Save-As edits the user might have made directly to it.

import { generateSprintCyclePattern } from './sprintCyclePattern';

export const BUILTIN_PATTERNS = [
    {
        id: 'builtin:sprint-cycle',
        name: 'Sprint Cycle',
        generate: () => generateSprintCyclePattern(),
    },
];

export function isBuiltinId(id) {
    return typeof id === 'string' && id.startsWith('builtin:');
}
