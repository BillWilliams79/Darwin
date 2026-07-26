// @vitest-environment jsdom
//
// Req #3071 — deleting a telemetry capture goes through a real dialog.
//
// This is the more dangerous of the two calls this requirement replaced. The
// unbind is reversible by rebinding; a capture is a MEASUREMENT of a harness that
// no longer exists, and its per-agent rows cascade away with the header. So the
// assertions here are about more than "a dialog appeared":
//
//   * the write does not fire until the dialog is confirmed, and never on cancel;
//   * the id deleted is the one the dialog was OPENED on, not whatever the picker
//     happens to be showing when the confirm lands — the two diverge the moment a
//     user changes the picker mid-dialog, and the page reads `activeRun` for
//     everything else;
//   * the dialog states the capture's SIZE, which the one-line picker cannot show
//     and which `window.confirm` never did.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let runsData = [];
let rowsByRun = {};
// Flipped by the one test that needs the rows still in flight — the page falls
// back to the run's stored `agent_count` for exactly that window.
let rowsLoading = false;

vi.mock('../../hooks/useDataQueries', () => ({
    useAgentTelemetryRuns: () => ({ data: runsData, isLoading: false }),
    useAgentTelemetryRowsByRun: (runId) => ({
        data: rowsLoading ? undefined : (rowsByRun[runId] || []), isLoading: rowsLoading,
    }),
    agentTelemetryRunKeys: { all: (c) => ['agent_telemetry_runs', c] },
}));

vi.mock('../actions/contextApi', () => ({
    deleteAgentTelemetryRun: vi.fn(),
}));

import ContextPage from '../ContextPage';
import * as api from '../actions/contextApi';
import AppContext from '../../Context/AppContext';
import AuthContext from '../../Context/AuthContext';
import { useSnackBarStore } from '../../stores/useSnackBarStore';

const URI = 'http://test.local';
const TOKEN = 'tok';
const CREATOR = 'tester';

// Two captures, newest first (the hook's own captured_at:desc order). Run 500 is
// the default selection; 501 exists so "deletes the one it was opened on" has
// something else to be wrong about.
const RUNS = [
    {
        id: 500, label: 'Baseline', captured_at: '2026-07-20T10:00:00',
        agent_count: 4, harness_version: '2.1.0', source_note: 'note five hundred',
    },
    {
        id: 501, label: 'Earlier', captured_at: '2026-07-10T10:00:00',
        agent_count: 2, harness_version: '2.0.0', source_note: null,
    },
];

// Row counts deliberately DISAGREE with agent_count on run 500 (3 loaded vs 4
// stored). The dialog is specified to report what is actually loaded and
// rendered, so a version reading the stored column shows 4 and fails here.
const ROWS = {
    500: [
        { id: 1, run_fk: 500, agent_name: 'Alpha', start_work_context_tokens: 10 },
        { id: 2, run_fk: 500, agent_name: 'Bravo', start_work_context_tokens: 20 },
        { id: 3, run_fk: 500, agent_name: 'Charlie', start_work_context_tokens: 30 },
    ],
    501: [
        { id: 4, run_fk: 501, agent_name: 'Alpha', start_work_context_tokens: 11 },
    ],
};

let container;
let root;
let queryClient;
let bump;

// `bump()` re-renders with whatever `runsData` now holds — a landed refetch.
function Harness() {
    const [, setTick] = useState(0);
    bump = () => setTick(t => t + 1);
    return <ContextPage />;
}

const mount = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <AppContext.Provider value={{ darwinUri: URI }}>
                    <AuthContext.Provider value={{ idToken: TOKEN, profile: { userName: CREATOR } }}>
                        <Harness />
                    </AuthContext.Provider>
                </AppContext.Provider>
            </QueryClientProvider>
        );
    });
};

beforeEach(() => {
    // MUI's useMediaQuery falls back to `defaultMatches` when matchMedia is absent,
    // which jsdom does not provide. Stubbed so the layout branch is deterministic
    // rather than dependent on that fallback.
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));

    runsData = RUNS.map(r => ({ ...r }));
    rowsByRun = { 500: [...ROWS[500]], 501: [...ROWS[501]] };
    rowsLoading = false;

    api.deleteAgentTelemetryRun.mockReset();
    api.deleteAgentTelemetryRun.mockResolvedValue({});
    useSnackBarStore.setState({ open: false, message: '' });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
});

const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

const clickAsync = async (el) => { await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}); };

const flush = async () => { await act(async () => {
    await Promise.resolve(); await Promise.resolve();
}); };

describe('ContextPage — capture delete goes through a real dialog', () => {
    it('opens the dialog rather than deleting on the spot', async () => {
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));

        expect(api.deleteAgentTelemetryRun).not.toHaveBeenCalled();
        expect(byTestId('telemetry-run-delete-dialog')).not.toBeNull();
    });

    it('names the capture and its date, so the confirm is about a specific run', async () => {
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));

        const text = document.querySelector('.MuiDialog-container').textContent;
        expect(text).toContain('Baseline');
        expect(text).toContain('2026-07-20');
    });

    it('states how many per-agent rows cascade away with it', async () => {
        // The picker renders a capture as one line, so its size — the thing being
        // destroyed — is invisible without this. Three rows are loaded for run 500.
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));

        expect(byTestId('telemetry-run-delete-rows').textContent).toContain('3');
    });

    it('explains WHY it is irreversible, not just that it is', async () => {
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));

        const warning = byTestId('telemetry-run-delete-warning');
        expect(warning).not.toBeNull();
        expect(warning.textContent).toContain('agent-telemetry-run');
    });

    it('does not claim this is the last capture when another one exists', async () => {
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));

        // Paired with the dialog-is-open assertion on purpose: `toBeNull()` alone
        // would also pass if the dialog had never opened at all.
        expect(byTestId('telemetry-run-delete-dialog')).not.toBeNull();
        expect(byTestId('telemetry-run-delete-last')).toBeNull();
    });

    it('warns when it IS the last capture, because the page then goes empty', async () => {
        runsData = [{ ...RUNS[0] }];
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));

        expect(byTestId('telemetry-run-delete-last')).not.toBeNull();
    });

    it('retracts the last-capture claim when one arrives while the dialog is open', async () => {
        // How many captures REMAIN is a fact about the LIST, not about the run being
        // deleted — so unlike the run id it must NOT be snapshotted at open time. A
        // frozen copy leaves the dialog asserting "It is the only capture stored"
        // after that has stopped being true, which is a false statement made at
        // exactly the moment the user is deciding.
        runsData = [{ ...RUNS[0] }];
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));
        expect(byTestId('telemetry-run-delete-last')).not.toBeNull();

        await act(async () => {
            runsData = [{ ...RUNS[0] }, { ...RUNS[1] }];
            bump();
        });

        expect(byTestId('telemetry-run-delete-dialog')).not.toBeNull();
        expect(byTestId('telemetry-run-delete-last')).toBeNull();
    });

    it('stops tracking the list once the question has been answered', async () => {
        // The mirror of the test above, and the reason `remainingCount` is live only
        // WHILE OPEN. After confirm the dialog is still fading, and the delete plus
        // its refetch routinely beat MUI's ~195ms exit — a still-live count would
        // rewrite the closing dialog to describe the world AFTER the decision,
        // growing a "this is the only capture" line into the dialog that asked a
        // question about the world before it.
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));
        expect(byTestId('telemetry-run-delete-last')).toBeNull();   // two exist

        await clickAsync(byTestId('telemetry-run-delete-confirm-btn'));
        await act(async () => {
            runsData = [{ ...RUNS[1] }];   // the refetch lands: one capture left
            bump();
        });

        // Still mounted (fading), and still describing the decision that was made.
        expect(byTestId('telemetry-run-delete-dialog')).not.toBeNull();
        expect(byTestId('telemetry-run-delete-last')).toBeNull();
    });

    it('does not say "all 0 rows" for a header with no per-agent rows', async () => {
        // Reachable: the run header and its rows are stored by separate MCP calls,
        // so an aborted capture leaves a header with nothing under it.
        rowsByRun[500] = [];
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));

        const text = byTestId('telemetry-run-delete-rows').textContent;
        expect(text).not.toMatch(/\b0\b/);
        expect(text).toContain('no per-agent measurement rows');
    });

    it('deletes nothing when the dialog is cancelled', async () => {
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));
        await clickAsync(byTestId('telemetry-run-delete-cancel-btn'));
        await flush();

        expect(api.deleteAgentTelemetryRun).not.toHaveBeenCalled();
    });

    it('deletes the selected capture on confirm', async () => {
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));
        await clickAsync(byTestId('telemetry-run-delete-confirm-btn'));
        await flush();

        expect(api.deleteAgentTelemetryRun)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 500);
    });

    it('deletes the run the dialog was OPENED on, even if a refetch moves the selection', async () => {
        // `activeRunId` is `selectedId ?? runsSorted[0].id`, and until the user
        // touches the picker `selectedId` is null — so the active run is whatever
        // sorts FIRST. A capture stored from another session (or the one the user
        // just took) lands at the head of a captured_at:desc list and silently
        // becomes `activeRun` under the open dialog.
        //
        // A confirm callback that re-read `activeRun` would then delete the capture
        // that just arrived instead of the one named in the dialog — an
        // irreplaceable measurement, destroyed with no wrong-looking click anywhere.
        // The id travels in the payload precisely so that cannot happen.
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));
        expect(document.querySelector('.MuiDialog-container').textContent)
            .toContain('Baseline');

        const ARRIVED = {
            id: 502, label: 'Arrived Mid-Dialog', captured_at: '2026-07-25T10:00:00',
            agent_count: 5, harness_version: '2.2.0', source_note: null,
        };
        rowsByRun[502] = [];
        await act(async () => {
            runsData = [ARRIVED, ...RUNS.map(r => ({ ...r }))];
            bump();
        });
        // The selection really moved — without this the assertion below could pass
        // for the wrong reason.
        expect(byTestId('agent-context-run-picker').textContent)
            .toContain('Arrived Mid-Dialog');

        await clickAsync(byTestId('telemetry-run-delete-confirm-btn'));
        await flush();

        expect(api.deleteAgentTelemetryRun)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 500);
    });

    it('falls back to the stored agent_count while the rows are still in flight', async () => {
        // The observed row count is preferred, but it does not exist yet on the
        // frames before the rows query settles. `agent_count` on run 500 is 4, and
        // the fixture's loaded rows are 3 — so this cannot pass by accident.
        rowsLoading = true;
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));

        expect(byTestId('telemetry-run-delete-rows').textContent).toContain('4');
    });

    it('renders the capture it is closing on, not a blank, after the confirm', async () => {
        // `useConfirmDialog` clears `infoObject` in the SAME pass that fires the
        // callback, so the dialog's `run` prop is undefined on the next render while
        // it is still fading out. Without the `lastShown` ref it returns null there
        // and pops off the screen mid-transition — invisible to every other test
        // here, which all assert on state before that render.
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));
        await clickAsync(byTestId('telemetry-run-delete-confirm-btn'));

        const dialog = byTestId('telemetry-run-delete-dialog');
        expect(dialog).not.toBeNull();
        expect(dialog.textContent).toContain('Baseline');
    });

    it('deletes once when the confirm button is clicked twice during the exit fade', async () => {
        // The button stays mounted and clickable through MUI's ~195ms close. The
        // second click re-fires the effect with the already-cleared `{}` payload.
        // Unguarded that is `undefined.id` raised inside a useEffect — it escapes to
        // an error boundary rather than to the snackbar — and if it did not throw it
        // would be a second DELETE of an irreplaceable measurement.
        mount();
        await clickAsync(byTestId('agent-context-delete-btn'));
        const confirmBtn = byTestId('telemetry-run-delete-confirm-btn');
        await clickAsync(confirmBtn);
        await clickAsync(confirmBtn);
        await flush();

        expect(api.deleteAgentTelemetryRun)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 500);
    });

    it('clears an explicit selection that pointed at the run it just deleted', async () => {
        // Otherwise `selectedId` keeps naming a row that no longer exists, and
        // `activeRunId` resolves to it forever: the picker holds an out-of-range
        // value and the table renders from a dead run instead of falling back to the
        // newest surviving capture.
        mount();
        await act(async () => {
            document.querySelector('.MuiSelect-select')
                .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        });
        await clickAsync(byTestId('agent-context-run-option-501'));
        expect(byTestId('agent-context-run-picker').textContent).toContain('Earlier');

        await clickAsync(byTestId('agent-context-delete-btn'));
        await clickAsync(byTestId('telemetry-run-delete-confirm-btn'));
        await flush();

        expect(api.deleteAgentTelemetryRun)
            .toHaveBeenCalledExactlyOnceWith(URI, TOKEN, 501);

        // The refetch lands with 501 gone. The picker must fall back to the newest
        // survivor rather than still pointing at the deleted row.
        await act(async () => {
            runsData = [{ ...RUNS[0] }];
            bump();
        });
        expect(byTestId('agent-context-run-picker').textContent).toContain('Baseline');
    });

    it('invalidates the runs cache after the delete, so the picker resyncs', async () => {
        mount();
        const spy = vi.spyOn(queryClient, 'invalidateQueries');

        await clickAsync(byTestId('agent-context-delete-btn'));
        await clickAsync(byTestId('telemetry-run-delete-confirm-btn'));
        await flush();

        const keys = spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
        expect(keys).toContain(JSON.stringify(['agent_telemetry_runs', CREATOR]));
    });

    it('surfaces a failed delete instead of swallowing it', async () => {
        api.deleteAgentTelemetryRun.mockRejectedValue(new Error('boom'));
        mount();

        await clickAsync(byTestId('agent-context-delete-btn'));
        await clickAsync(byTestId('telemetry-run-delete-confirm-btn'));
        await flush();

        expect(useSnackBarStore.getState().open).toBe(true);
    });
});
