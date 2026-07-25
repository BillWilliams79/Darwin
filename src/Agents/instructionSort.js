import GroupsIcon from '@mui/icons-material/Groups';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SortByAlphaIcon from '@mui/icons-material/SortByAlpha';

// Browse-list sort vocabulary for /agents/instructions (req #3063).
//
// Its own module rather than exports from InstructionsPage.jsx: mixing non-component
// exports into a component file drops that file out of React Fast Refresh, so every
// edit to the page forced a full browser reload during development. It also lets the
// tests exercise the comparator without pulling MUI into the test environment.

// Sort modes for the browse list, per the frontend-architect's viewer-header
// ruling. `agents` (Agent Count) is the PAGE DEFAULT and is NOT a convenience:
// this page exists to make blast radius legible, so the rows binding the most
// agents lead unless the user asks otherwise. DEFAULT_SORT_MODE below is the one
// place that default is stated.
//
// Comparators are written ASCENDING and multiplied by the direction, so a mode
// and its reverse can never disagree about ties. `defaultDesc` is per mode
// because "most agents" and "newest" are the useful ends of their axes while
// "A→Z" is the useful end of the name axis.
// The page default. Named once, here, so nothing infers it from array order.
export const DEFAULT_SORT_MODE = 'agents';

export const SORT_MODES = [
    { value: 'agents', label: 'Agent Count',     icon: GroupsIcon,      defaultDesc: true  },
    { value: 'name',   label: 'Name',            icon: SortByAlphaIcon, defaultDesc: false },
    { value: 'date',   label: 'Last updated',    icon: ScheduleIcon,    defaultDesc: true  },
];

// `update_ts` is NULL until a row is first edited, so an unedited row falls back
// to its creation time — otherwise every never-touched instruction sorts as if it
// were from 1970 and the "newest" list is meaningless.
export const lastTouched = (i) => Date.parse(i.update_ts || i.create_ts || '') || 0;

export const SORT_ASC = {
    agents: (a, b) => a.refs.length - b.refs.length,
    name:   (a, b) => a.name.localeCompare(b.name),
    date:   (a, b) => lastTouched(a) - lastTouched(b),
};

// Cross-tab (localStorage), unlike the per-tab VIEW preference: a sort is a
// standing preference about the catalog, not about this tab's task.
export const SORT_STORAGE_KEY = 'darwin-instructions-sort';
export const readStoredSort = () => {
    try {
        const stored = localStorage.getItem(SORT_STORAGE_KEY);
        return SORT_MODES.some(m => m.value === stored) ? stored : DEFAULT_SORT_MODE;
    } catch { return DEFAULT_SORT_MODE; }   // Safari private mode
};

/**
 * The full row comparator: the open/closed split OUTRANKS the user's chosen sort,
 * in every mode and in both directions. A closed instruction binds nothing at
 * boot, so it never belongs above a live one — not even when it would sort first
 * alphabetically or by agent count.
 */
export const compareInstructionRows = (mode, desc) => {
    const dir = desc ? -1 : 1;
    const primary = SORT_ASC[mode] || SORT_ASC[DEFAULT_SORT_MODE];
    return (a, b) =>
        (a.closed ? 1 : 0) - (b.closed ? 1 : 0)
        || dir * primary(a, b)
        // Name is the stable tiebreak, and a total one: `instructions.name` carries
        // a UNIQUE key, so no two rows can tie here and the sort never shuffles
        // between renders. (It used to fall back to the catalog order first;
        // migration 072 dropped that column.)
        || a.name.localeCompare(b.name);
};

