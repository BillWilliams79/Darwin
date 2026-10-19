import { create } from 'zustand';

export const useSnackBarStore = create((set) => ({
    open: false,
    message: '',
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
            set({ message: error, open: true, duration: null, action: null });
            return;
        }
        const status = error?.httpStatus?.httpStatus;
        set({ message: status ? `${errorText} ${status}` : errorText, open: true, duration: null, action: null });
    },
    // A plain message that needs longer than the default to read — the
    // focus-loss capture names its culprit here (req #3632).
    showMessage: (message, { duration = null, action = null } = {}) =>
        set({ message, open: true, duration, action }),
    close: () => set({ open: false }),
}));
