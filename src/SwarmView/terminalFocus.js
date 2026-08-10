// terminalFocus.js — WHICH TERMINAL WINDOW a swarm session runs in, and whether
// this browser may offer to focus it (req #3455).
//
// One module so the Sessions grid, the mobile card and the session detail page
// cannot disagree about when a link is offered — the interesting cases here are
// all about when it must NOT be, and three copies of that judgement would drift.
//
// ── THE CLICK CONTRACT (shared with the Mac handler) ──────────────────────────
//
//     darwin-term://focus?window=<handle>&session=<id>&label=<text>
//
// Deliberately PLATFORM-NEUTRAL: the scheme, the action and the parameters are
// identical on every machine, and only the OS-side handler differs. Nothing in
// this file knows about iTerm2. The Windows Terminal handler (machine 3) is a
// follow-on and speaks the same URL, so this builder never needs to learn which
// backend it is addressing.
//
// The handler is scripts/swarm/terminal-focus/ in DarwinAI-Config. The two sides
// cannot share code — one is a browser bundle, the other is a shell script on a
// different machine — so each asserts the shape in its own tests. See that
// directory's README.md § The contract.

export const TERMINAL_FOCUS_SCHEME = 'darwin-term';

// What a session's terminal chip can be. Kept as a small closed vocabulary
// rather than a boolean because the NOT-offered cases each need their own
// sentence: "no terminal recorded" and "that terminal is on another machine"
// send the user to completely different places.
export const TERMINAL_STATE = {
    NONE: 'none',            // nothing recorded — render no chip at all
    LINK: 'link',            // this browser's machine — clickable
    REMOTE: 'remote',        // a DIFFERENT machine's terminal — shown, not clickable
    NO_HANDLE: 'no_handle',  // a window NUMBER but no durable handle — shown, not clickable
    UNKNOWN_HOST: 'unknown', // cannot tell which machine this browser is — shown, not clickable
    LOADING: 'loading',      // the machines list has not arrived — shown, no claim made
};

// States that render a chip. NONE renders nothing; everything else is a fact
// worth showing even when it cannot be clicked, because a chip that silently
// disappears reads as "no terminal recorded" — a different and wrong answer.
export const TERMINAL_VISIBLE = (state) => state !== TERMINAL_STATE.NONE;

/**
 * The platform family of the machine this BROWSER is running on, in the
 * vocabulary of `machines.platform` (darwin | wsl | linux).
 *
 * A browser cannot read its hostname, so this is the only self-identification
 * available. `userAgentData.platform` is the modern, un-frozen source;
 * `navigator.platform` is the deprecated fallback that still works everywhere.
 *
 * Windows maps to `wsl` ON PURPOSE: Windows Terminal runs on Windows while the
 * worker (and its `machines` row) lives in WSL, so the browser reports Windows
 * for a machine Darwin records as `wsl`. Mapping it anywhere else would make
 * machine 3 permanently unmatchable.
 */
export const browserPlatformFamily = (nav = typeof navigator !== 'undefined' ? navigator : null) => {
    if (!nav) return null;
    const raw = String(nav.userAgentData?.platform || nav.platform || nav.userAgent || '')
        .toLowerCase();
    if (!raw) return null;
    if (raw.includes('mac')) return 'darwin';
    if (raw.includes('win')) return 'wsl';
    if (raw.includes('linux') || raw.includes('android')) return 'linux';
    return null;
};

/**
 * WHICH REGISTERED machine is this browser most likely on?
 *
 * Answered as: the UNIQUE open machine whose platform family matches the
 * browser's. Today that resolves unambiguously — production holds one `darwin`
 * (Mac Mini) and one `wsl` (MCHP Windows).
 *
 * Returns null when ZERO match, and also when TWO OR MORE match — a guess
 * between two registered Macs is refused rather than made.
 *
 * THIS IS A GUESS, AND THE NAME OF THE FUNCTION OVERSTATES IT. A browser cannot
 * read its own hostname, so a machine that is NOT in the registry is
 * indistinguishable from the one that is: open darwin.one on an unregistered
 * MacBook (or iPadOS Safari, which reports `MacIntel`) and this returns the Mac
 * mini's id, because it is the only open `darwin` row. The link would then be
 * offered for a window on a different desk — and if the handler happens to be
 * installed there too, an unrelated local window with the same id could be
 * focused.
 *
 * That hole is NOT closed here, because it cannot be: it is closed at the
 * HANDLER, which does know its own hostname. `terminalFocusUrl` carries the
 * target machine's `hostname` in the URL and `focus-terminal.sh` refuses a
 * mismatch with an honest message. So a wrong guess here costs a refusal the
 * user can read, never a wrongly-focused window.
 */
export const resolveThisMachineId = (machines, nav) => {
    const family = browserPlatformFamily(nav);
    if (!family) return null;
    const matches = (machines || []).filter(m => !m.closed && m.platform === family);
    return matches.length === 1 ? matches[0].id : null;
};

/**
 * The `darwin-term://` URL for a session, or null when it has no handle.
 *
 * `host` is the TARGET machine's hostname, and it is the only guard that
 * actually works: `resolveThisMachineId` above is a guess a browser cannot
 * verify, but the handler runs ON a machine and can compare this against its
 * own `hostname -s`. A mismatch is refused there. Omitted when the machine is
 * unknown or unregistered — the handler treats an absent `host` as "unchecked"
 * rather than inventing a match, since an older Darwin build sends none.
 *
 * Every component is percent-encoded: `label` is a user-authored task title and
 * routinely contains spaces, '&' and '#', any one of which silently truncates
 * or splits an unencoded query string.
 */
export const terminalFocusUrl = (session, machines) => {
    if (!session?.terminal_window_id) return null;
    const params = new URLSearchParams({ window: String(session.terminal_window_id) });
    if (session.id != null) params.set('session', String(session.id));
    const label = session.title || session.task_name;
    if (label) params.set('label', String(label));
    const host = (machines || []).find(m => m.id === session.machine_fk)?.hostname;
    if (host) params.set('host', String(host));
    return `${TERMINAL_FOCUS_SCHEME}://focus?${params.toString()}`;
};

/**
 * What to render for a session's terminal.
 *
 * `label` is the POSITIONAL window number when there is one ("Window 4") because
 * that is what a human reads off their screen, falling back to the durable
 * handle when there is not. The handle is what the LINK carries either way —
 * the number is display only and goes stale the moment a window closes, which
 * is exactly why both columns exist.
 *
 * Returns: { state, label, title, href }
 *   href is non-null only for state === LINK.
 */
export const terminalFocusState = (session, machines, nav) => {
    if (!session?.terminal_window_id && session?.terminal_number == null) {
        return { state: TERMINAL_STATE.NONE, label: null, title: null, href: null };
    }

    // "Terminal 4", not "Window 4" — Darwin already calls this a terminal
    // everywhere else the user meets it (the Sessions column header, the NavBar
    // "Terminal - N" callout, `dev_servers.terminal_number`), and the number IS
    // the iTerm Window-menu hotkey the user types. One noun for one thing.
    const label = session.terminal_number != null
        ? `Terminal ${session.terminal_number}`
        : `Terminal ${session.terminal_window_id}`;

    const machineName = (machines || []).find(m => m.id === session.machine_fk)?.title;
    const where = machineName || (session.machine_fk != null ? `machine #${session.machine_fk}` : 'an unknown machine');

    if (!session.terminal_window_id) {
        // A number with no handle: recorded before the handle existed, or a
        // partial write. Nothing durable to click — but the number is still a
        // fact, so this gets its OWN state rather than reusing NONE. Reusing
        // NONE gave it a label that the grid rendered and the two other
        // consumers suppressed, which is one state meaning two things.
        return {
            state: TERMINAL_STATE.NO_HANDLE,
            label,
            title: `${label} on ${where} — no window handle was recorded, so it cannot be focused from here.`,
            href: null,
        };
    }

    // NOT-YET-KNOWN IS NOT THE SAME AS CANNOT-BE-KNOWN. `useMachines` returns
    // undefined while its query is in flight, and answering UNKNOWN_HOST there
    // asserts "this browser cannot tell which machine it is on" — a definite
    // claim about a question nobody has asked yet, which then flips to a
    // clickable link a moment later. An empty ARRAY is a real answer (no
    // machines registered); undefined is the absence of one.
    if (machines === undefined || machines === null) {
        return {
            state: TERMINAL_STATE.LOADING,
            label,
            title: `${label} — still resolving which machine this is.`,
            href: null,
        };
    }

    const thisMachineId = resolveThisMachineId(machines, nav);

    if (thisMachineId == null) {
        return {
            state: TERMINAL_STATE.UNKNOWN_HOST,
            label,
            title: `${label} on ${where}. This browser cannot tell which machine it is running on, so it will not offer to focus a window that may be on a different desk.`,
            href: null,
        };
    }

    if (session.machine_fk !== thisMachineId) {
        return {
            state: TERMINAL_STATE.REMOTE,
            label,
            title: `${label} on ${where} — a different machine from this browser, so there is nothing here to bring to the front.`,
            href: null,
        };
    }

    // `where` is named in the tooltip deliberately: this browser's machine is a
    // GUESS from its platform family (see resolveThisMachineId), so saying which
    // machine the click assumes lets the user catch a wrong one. The handler
    // refuses a hostname mismatch regardless.
    return {
        state: TERMINAL_STATE.LINK,
        label,
        title: `Bring ${label} on ${where} to the front`,
        href: terminalFocusUrl(session, machines),
    };
};
