import { create } from 'zustand';

/** How many recent messages `history` keeps (req #4159). */
export const SNACKBAR_HISTORY_MAX = 5;
/** Characters of one message kept in `history`. */
export const SNACKBAR_HISTORY_TEXT_MAX = 500;

// What the reader SAW, for the Requirement Filer's debug capture (req #4159):
// a snackbar hides itself after 2 s, so by the time the reader presses the
// filer its message is gone from the screen — and a client-side refusal (3877,
// EpicsPage's showError before any request) exists nowhere else. Newest last.
const remember = (history, kind, message) => [
    ...(Array.isArray(history) ? history : []),
    { t: Date.now(), kind, message: typeof message === 'string'
        ? message.slice(0, SNACKBAR_HISTORY_TEXT_MAX) : String(message ?? '').slice(0, SNACKBAR_HISTORY_TEXT_MAX) },
].slice(-SNACKBAR_HISTORY_MAX);

export const useSnackBarStore = create((set) => ({
    open: false,
    message: '',
    // The last SNACKBAR_HISTORY_MAX messages shown: { t, kind: 'error' |
    // 'message', message }. Read by RequirementFiler/debugBundle.js.
    history: [],
    // ms before auto-hide; null = the SnackBar's own default. Reset by every
    // showError, so only `showMessage` callers get a longer read (req #3632).
    duration: null,
    // { label, onClick } for one button beside the close X; null = none. Reset
    // by every showError (req #3652 — the focus-loss alert's "Copy for Claude").
    action: null,
    showError: (error, errorText) => {
        // Tolerate an error WITHOUT `httpStatus`. call_rest_api throws a bare
        // {data, httpStatus} for non-2xx, but a fetch-level failure is RETURNED
        // as a synthetic 503 and callers may wrap it in a plain Error. Reading
        // `error.httpStatus.httpStatus` unguarded threw a TypeError from inside
        // the caller's catch block, killing whatever recovery followed the
        // showError call (req #3049).
        // Single-argument callers pass the message itself as `error` (several in
        // Customers / CustomerReleases do). Without this they render an empty
        // snackbar — previously they threw instead, so neither form ever worked.
        if (typeof error === 'string' && errorText === undefined) {
            set(s => ({ message: error, open: true, duration: null, action: null,
                history: remember(s.history, 'error', error) }));
            return;
        }
        const status = error?.httpStatus?.httpStatus;
        const message = status ? `${errorText} ${status}` : errorText;
        set(s => ({ message, open: true, duration: null, action: null, history: remember(s.history, 'error', message) }));
    },
    // A plain message that needs longer than the default to read — the
    // focus-loss capture names its culprit here (req #3632).
    showMessage: (message, { duration = null, action = null } = {}) =>
        set(s => ({ message, open: true, duration, action, history: remember(s.history, 'message', message) })),
    close: () => set({ open: false }),
}));
