// The generic form of the `activeView` line every hand-rolled viewer header grew
// (req #3067).
//
// ITS OWN MODULE, with no JSX and no MUI import. Two reasons, both learned the hard
// way on `instructionSort.js`: mixing non-component exports into a component file
// drops that file out of React Fast Refresh, and a pure module can be exercised by
// vitest without pulling MUI into the test environment.

/**
 * The view value that should actually be RENDERED, given what the page offers.
 *
 * A stored preference can name a view that no longer exists, or one that exists but
 * is disabled — `/agents/instructions` shipped for a fortnight with a `'table'`
 * value reachable in storage and no Table button to match it. An unmatched
 * ToggleButtonGroup value selects nothing, so the toggle renders with no active
 * state at all.
 *
 * NEVER WRITE THE RESULT BACK through `onViewChange`. The stored value is a record
 * of what the USER ASKED FOR; a missing or disabled view is a temporary condition of
 * the PAGE. Writing back converts that temporary condition into a permanent
 * preference change the user never made and cannot detect — and because
 * `useViewPreference` writes `localStorage` as well as `sessionStorage`, it would be
 * permanent across every tab. Req #3063 is the worked example: a user who chose
 * Table before the button was pulled still means Table, and req #3067 gives it back
 * to them for free precisely because nothing overwrote it.
 *
 * This is the same principle as GhostTextField's re-seed guard — never let an
 * external condition silently overwrite uncommitted user intent — applied to
 * preferences instead of text.
 *
 * @param {string} view    the stored/selected value
 * @param {Array<{value: string, disabled?: boolean}>} views  the page's view list
 * @returns {string|undefined} `view` when it names an enabled entry, otherwise the
 *   first enabled entry's value (falling back to the first entry at all, so a list
 *   that is somehow entirely disabled still selects something rather than nothing).
 */
export const normalizeView = (view, views = []) => {
    const enabled = views.filter(v => !v.disabled);
    if (enabled.some(v => v.value === view)) return view;
    return enabled[0]?.value ?? views[0]?.value;
};

export default normalizeView;
