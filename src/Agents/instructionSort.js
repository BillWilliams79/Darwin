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
//
// THE STORED VALUE IS UTC AND CARRIES NO MARKER. Lambda-Rest hands the frontend
// MySQL DATETIME strings in `YYYY-MM-DD HH:MM:SS` form; ECMAScript parses that
// space-separated shape as LOCAL time, so a bare `Date.parse` shifts every
// timestamp by the viewer's UTC offset. The `T`/`Z` normalization here is the same
// one `utils/dateFormat.js` applies, kept in this module so a single call site
// cannot get it wrong.
//
// It was invisible until req #3067. For SORTING the offset is uniform and cancels,
// so the ordering has always been right — but #3067 made this the `Last updated`
// COLUMN's value, and a display is not offset-invariant. Every row stored between
// 00:00 and 08:00 UTC rendered tomorrow's date to a US Pacific viewer, and disagreed
// with the `Created` column beside it, which parsed correctly.
// The condition is "carries NO timezone information", not "contains a space".
// `utils/dateFormat.js` normalizes only the space form, which is sufficient there
// because it is only ever handed Lambda-Rest output — but this is an EXPORTED helper
// with a generic name, and the next caller to pass it an ISO-without-offset string
// (`2026-07-26T02:00:00`) would silently re-acquire the exact off-by-one-day defect
// it exists to remove. Widened deliberately: on every input either function actually
// sees this is a superset of dateFormat's behaviour, so the two cannot disagree on
// real data — they only differ on a shape Lambda-Rest never emits.
const NO_TIMEZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

export const dbTimestamp = (value) => {
    if (!value) return 0;
    const iso = (typeof value === 'string' && NO_TIMEZONE.test(value))
        ? `${value.replace(' ', 'T')}Z`
        : value;
    return Date.parse(iso) || 0;
};

export const lastTouched = (i) => dbTimestamp(i.update_ts || i.create_ts);

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

// The Table view sorts through the DataGrid's own column headers rather than
// through the gear — two sort UIs on one page that can disagree is a bug generator,
// and a grid with dead headers reads as broken. This maps the gear's vocabulary onto
// the grid's columns so switching views SEEDS the grid from the persisted mode
// instead of jumping to an unrelated order (req #3067).
//
// The mapping is one-way and seed-only. The grid never writes a sort back to
// `darwin-instructions-sort`: a column click is a transient act on this table, while
// the stored mode is a standing preference about the catalog.
//
// KNOWN LOSS, and it is deliberate. `compareInstructionRows` pins closed rows last
// STRUCTURALLY, in every mode and both directions. A DataGrid sort model cannot
// express a primary key it did not sort by, so in Table view a closed row can sort
// above open ones. Acceptable because closed rows only appear once the user has
// turned the Closed filter on — they are already in a deliberate mode. Cards keep
// the pin.
export const GRID_FIELD_BY_SORT_MODE = {
    agents: 'agent_count',
    name:   'name',
    date:   'update_ts',
};

export const gridSortFromMode = (mode, desc) => ({
    field: GRID_FIELD_BY_SORT_MODE[mode] || GRID_FIELD_BY_SORT_MODE[DEFAULT_SORT_MODE],
    sort: desc ? 'desc' : 'asc',
});

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

