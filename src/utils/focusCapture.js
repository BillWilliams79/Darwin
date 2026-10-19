// focusCapture.js — turn a live focus event into one block to paste to Claude
// (req #3652).
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Req #3632's recorder catches a focus loss in the reader's own browser, but
// its only hand-off was `copy(darwinFocusLossReport())` typed into DevTools —
// and the reader, looking at the moment it happened, did not know what to tell
// Claude. So the capture is assembled HERE, with everything a diagnosis needs,
// and reaches the clipboard in one action:
//
//   • the focus-loss alert's "Copy for Claude" button (the detector fired), or
//   • Ctrl+Shift+F, anywhere in the app (the detector did NOT fire — the
//     click never landed, or the caret blinks while keys go elsewhere). Press
//     it right after the surprise, without clicking anything first: the
//     capture records where focus IS at that moment.
//
// DevTools still works: `copy(darwinFocusCapture())`.
//
// The block is self-describing — it says what it is and which build produced
// it (production stacks are minified; the commit is what lets them be mapped).

import { describeElement, focusTimeline, installFocusTimeline, storedFocusLosses } from './focusLossRecorder';
import { useSnackBarStore } from '../stores/useSnackBarStore';

export const CAPTURE_HOTKEY = 'Ctrl+Shift+F';
// The timeline is a ring of 200; a minute is enough to cover "I clicked, it
// went somewhere, I reached for the hotkey".
const TIMELINE_WINDOW_MS = 60000;
// Losses older than this are a different afternoon's evidence.
const LOSS_WINDOW_MS = 24 * 60 * 60 * 1000;

// Stored losses (across reloads) plus this page's own list — the in-page list
// is the only copy when localStorage refused the write — and the alerted
// report itself, de-duplicated on `at`.
function recentLosses(report, now) {
    const byAt = new Map();
    for (const loss of [...storedFocusLosses(), ...(window.__darwinFocusLoss || []), report]) {
        if (loss && loss.at) byAt.set(loss.at, loss);
    }
    return [...byAt.values()]
        .filter((loss) => !(now - Date.parse(loss.at) > LOSS_WINDOW_MS))
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function ancestry(el) {
    const ids = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) {
        const id = n.getAttribute?.('data-testid');
        if (id) ids.push(id);
    }
    return ids;
}

function describeActive() {
    const el = document.activeElement;
    const info = { element: describeElement(el), testidPath: ancestry(el) };
    if (el && typeof el.selectionStart === 'number') {
        info.caret = el.selectionStart;
        info.valueLength = el.value?.length ?? null;
    }
    if (el && el !== document.body) {
        info.disabled = Boolean(el.disabled);
        info.connected = el.isConnected;
    }
    return info;
}

/**
 * The capture as text: a one-line instruction, then the JSON.
 * @param {{ reason: string, report?: object }} opts — `report` is the loss
 *   that raised the alert, when there is one (it is also in `losses`).
 */
export function buildFocusCapture({ reason, report = null } = {}) {
    const now = Date.now();
    const payload = {
        capture: 'darwin focus capture (req #3652)',
        reason,
        capturedAt: new Date(now).toISOString(),
        build: {
            commit: import.meta.env.VITE_BUILD_COMMIT || 'unknown',
            mode: import.meta.env.MODE,
        },
        url: window.location.pathname + window.location.search,
        userAgent: navigator.userAgent,
        document: { hasFocus: document.hasFocus(), visibilityState: document.visibilityState },
        activeElement: report
            ? { ...describeActive(), note: 'focus is on the button that copied this; the loss is alertedLoss in losses[]' }
            : describeActive(),
        alertedLoss: report ? report.at : null,
        losses: recentLosses(report, now),
        timeline: focusTimeline(now - TIMELINE_WINDOW_MS)
            .map(({ t, ...e }) => ({ msAgo: now - t, ...e })),
    };
    return 'Darwin focus capture — paste this whole block to Claude.\n'
        + '```json\n' + JSON.stringify(payload, null, 2) + '\n```\n';
}

/**
 * Build the capture and put it on the clipboard, confirming in the snackbar.
 * The capture is built SYNCHRONOUSLY, before anything can move focus.
 * Also kept on `window.__darwinFocusCapture` in case the clipboard refuses.
 */
export async function copyFocusCapture(opts) {
    const text = buildFocusCapture(opts);
    window.__darwinFocusCapture = text;
    const { showMessage } = useSnackBarStore.getState();
    try {
        await navigator.clipboard.writeText(text);
        showMessage('Focus capture copied — paste it to Claude.', { duration: 6000 });
        return true;
    } catch {
        showMessage('Could not copy the focus capture. In DevTools run: copy(__darwinFocusCapture)',
            { duration: 15000 });
        return false;
    }
}

// `code` OR `key`: Option/AltGr layouts change `key`, Dvorak changes `code`.
function isCaptureHotkey(e) {
    return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && !e.repeat
        && (e.code === 'KeyF' || e.key === 'F' || e.key === 'f');
}

/** Start the timeline and the hotkey. Idempotent; call once at app start. */
export function installFocusCapture() {
    // On `window`, not module state, so a dev hot-reload does not add a
    // second hotkey listener (two captures per press).
    if (typeof document === 'undefined' || window.__darwinFocusCaptureInstalled) return;
    window.__darwinFocusCaptureInstalled = true;
    installFocusTimeline();
    document.addEventListener('keydown', (e) => {
        if (!isCaptureHotkey(e)) return;
        e.preventDefault();
        copyFocusCapture({ reason: `hotkey ${CAPTURE_HOTKEY}` });
    }, true);
    window.darwinFocusCapture = () => buildFocusCapture({ reason: 'devtools' });
}
