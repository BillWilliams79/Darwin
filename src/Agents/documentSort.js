import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SortByAlphaIcon from '@mui/icons-material/SortByAlpha';

// Browse-list sort vocabulary for /agents/documents (req #3051).
//
// Its own module rather than exports from DocumentsPage.jsx, for the two reasons
// instructionSort.js gives and that apply verbatim here: mixing non-component
// exports into a component file drops that file out of React Fast Refresh, so
// every edit forces a full browser reload during development; and it lets vitest
// exercise the comparator without pulling MUI into the test environment.
//
// This control also has a second job. `architecture_documents.sort_order` is
// incoherent — 13 rows share the value 1, one is NULL, and the range is 1..16 —
// and the page has always discarded it by re-sorting on name. The server default
// sort was the column's last consumer, so retiring it here (devopsQueries now
// asks for `name:asc`) is what makes the follow-on migration that drops the
// column a one-line change. Exactly the move req #3063 made before migration 072
// dropped `instructions.sort_order`.

// The page default. Named once, here, so nothing infers it from array order.
//
// OWNER, not name, and that is not a convenience: this page exists to answer
// "who owns this file?", which is the question that had no answer before the
// registry existed and the reason ownership drifted silently for years. The
// owner axis leads unless the user asks otherwise.
export const DEFAULT_SORT_MODE = 'owner';

export const SORT_MODES = [
    { value: 'owner',  label: 'Owner',        icon: PersonIcon,      defaultDesc: false },
    { value: 'name',   label: 'Name',         icon: SortByAlphaIcon, defaultDesc: false },
    { value: 'agents', label: 'Agent Count',  icon: GroupsIcon,      defaultDesc: true  },
    { value: 'date',   label: 'Last updated', icon: ScheduleIcon,    defaultDesc: true  },
];

// `update_ts` is NULL until a row is first edited, so an unedited row falls back
// to its creation time — otherwise every never-touched document sorts as if it
// were from 1970 and the "newest" list is meaningless.
export const lastTouched = (d) => Date.parse(d.update_ts || d.create_ts || '') || 0;

/** The owning agent's name, or '' when the document is unowned. */
export const ownerName = (d) => d.ownerName || '';

// Comparators are written ASCENDING and multiplied by the direction, so a mode
// and its reverse can never disagree about ties.
export const SORT_ASC = {
    // Unowned rows are handled by the pin below, not here, so this only ever
    // compares two rows that both have an owner (or two that both do not).
    owner:  (a, b) => ownerName(a).localeCompare(ownerName(b)),
    name:   (a, b) => (a.name || '').localeCompare(b.name || ''),
    agents: (a, b) => a.links.length - b.links.length,
    date:   (a, b) => lastTouched(a) - lastTouched(b),
};

// Cross-tab (localStorage), unlike the per-tab VIEW preference: a sort is a
// standing preference about the catalog, not about this tab's task.
export const SORT_STORAGE_KEY = 'darwin-documents-sort';
export const readStoredSort = () => {
    try {
        const stored = localStorage.getItem(SORT_STORAGE_KEY);
        return SORT_MODES.some(m => m.value === stored) ? stored : DEFAULT_SORT_MODE;
    } catch { return DEFAULT_SORT_MODE; }   // Safari private mode
};

/**
 * The full row comparator.
 *
 * TWO structural rules outrank the user's chosen sort, and they are deliberately
 * different in scope:
 *
 * 1. CLOSED LAST, in every mode and both directions. A closed document is in no
 *    agent's boot payload, so it never belongs above a live one — not even when
 *    it would sort first alphabetically. Same rule as the instruction list.
 *
 * 2. UNOWNED FIRST, in the `owner` mode ONLY, in both directions. An unowned
 *    document is the drift this registry exists to surface, so when the user is
 *    reading by owner it leads. It is scoped to that one mode on purpose: pinning
 *    it in `name` mode would produce an alphabetical list that is not
 *    alphabetical, which reads as a bug rather than as emphasis.
 *
 * Name is the stable tiebreak, and a total one: `architecture_documents.name`
 * carries a UNIQUE key, so no two rows can tie and the order never shuffles
 * between renders.
 */
export const compareDocumentRows = (mode, desc) => {
    const dir = desc ? -1 : 1;
    const primary = SORT_ASC[mode] || SORT_ASC[DEFAULT_SORT_MODE];
    return (a, b) =>
        (a.closed ? 1 : 0) - (b.closed ? 1 : 0)
        || (mode === 'owner' ? (a.owner ? 1 : 0) - (b.owner ? 1 : 0) : 0)
        || dir * primary(a, b)
        || (a.name || '').localeCompare(b.name || '');
};
