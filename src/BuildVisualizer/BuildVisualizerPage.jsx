import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import { useQuery } from '@tanstack/react-query';
import BuildVisualizerControls from './BuildVisualizerControls';
import { useBuildPatterns } from './useBuildPatterns';
import { BRANCH_TYPES } from './branchTypeChipStyles';
import {
    DEFAULT_DARK_VARIANT,
    LIGHT_TRANSPORT_VARIANT,
    isThemeVariant,
} from './themeVariants';
import ThemeContext from '../Theme/ThemeContext';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';

// localStorage key shared with Topology/build-visualizer/app.js (req #2598;
// React shell owns the toggle UI since req #2616 but the iframe still reads
// this key on standalone boot so dev workflow stays unchanged).
const VERSION_LANES_STORAGE_KEY = 'darwin.buildVisualizer.versionLanes.v1';

// User's preferred DARK variant (req #2621). Independent of Darwin's app
// mode — when the app is light we don't touch this key; when the app
// flips back to dark we apply the stored choice. The picker only shows
// when the app is in dark mode, and only lists dark variants.
const DARK_VARIANT_STORAGE_KEY = 'darwin.buildVisualizer.darkVariant.v1';

// Release-event overlay state (req #2606). Keys match the iframe's
// localStorage so standalone mode and embedded mode agree on the boot value.
const SHOW_RELEASES_STORAGE_KEY = 'darwin.bv.showReleases';
const RELEASE_STYLE_STORAGE_KEY = 'darwin.bv.releaseStyle';

const readShowReleases = () => {
    try {
        return window.localStorage.getItem(SHOW_RELEASES_STORAGE_KEY) !== 'off';
    } catch (_) { return true; }
};

const writeShowReleases = (value) => {
    try {
        window.localStorage.setItem(SHOW_RELEASES_STORAGE_KEY, value ? 'on' : 'off');
    } catch (_) { /* private mode — accept transient state */ }
};

const readReleaseStyle = () => {
    try {
        const v = parseInt(window.localStorage.getItem(RELEASE_STYLE_STORAGE_KEY) || '', 10);
        return Number.isFinite(v) && v >= 1 && v <= 5 ? v : 1;
    } catch (_) { return 1; }
};

const writeReleaseStyle = (value) => {
    try {
        window.localStorage.setItem(RELEASE_STYLE_STORAGE_KEY, String(value));
    } catch (_) { /* private mode — accept transient state */ }
};

const readVersionLanes = () => {
    try {
        return window.localStorage.getItem(VERSION_LANES_STORAGE_KEY) !== 'off';
    } catch (_) {
        return true;
    }
};

const writeVersionLanes = (value) => {
    try {
        window.localStorage.setItem(VERSION_LANES_STORAGE_KEY, value ? 'on' : 'off');
    } catch (_) { /* private mode — accept transient state */ }
};

const readStoredDarkVariant = () => {
    try {
        const v = window.localStorage.getItem(DARK_VARIANT_STORAGE_KEY);
        return isThemeVariant(v) ? v : null;
    } catch (_) {
        return null;
    }
};

const writeStoredDarkVariant = (variant) => {
    try {
        window.localStorage.setItem(DARK_VARIANT_STORAGE_KEY, variant);
    } catch (_) { /* private mode — accept transient state */ }
};

const BuildVisualizerPage = () => {
    const iframeRef = useRef(null);
    const iframeReady = useRef(false);
    const prevActiveIdRef = useRef(null);
    const lib = useBuildPatterns();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    // Customer list — for the Perform Release Event Dialog. Fetched once per
    // page (TanStack Query default staleTime is fine; this list rarely changes).
    const customersQuery = useQuery({
        queryKey: ['customers', profile?.id],
        queryFn: () => fetchEntity(`${darwinUri}/customers`, idToken),
        enabled: !!idToken && !!profile?.id && !!darwinUri,
    });
    // Release-event Dialog state: opened when the iframe posts bv:release-prompt;
    // closed by Cancel or by completing the POST flow.
    const [releaseDialog, setReleaseDialog] = useState(null);
    const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
    // All branch types start selected — deselecting hides that type (and any
    // descendants rooted on it) in the iframe renderer.
    const [selectedTypes, setSelectedTypes] = useState(() => [...BRANCH_TYPES]);
    // Mirror selectedTypes into a ref so the bv:ready handler can read the
    // latest value without forcing the message-listener effect to re-register
    // on every chip toggle.
    const selectedTypesRef = useRef(selectedTypes);
    useEffect(() => { selectedTypesRef.current = selectedTypes; }, [selectedTypes]);

    // Stagger toggle (req #2616 — relocated from iframe #toolbar to the React
    // shell). React owns the UI; iframe owns the renderer effect. Initialised
    // from localStorage so reload survives, and an inbound
    // bv:version-lanes-state from the iframe at boot adopts whatever value the
    // iframe started with (covers the case where standalone mode flipped it).
    const [staggerOn, setStaggerOn] = useState(() => readVersionLanes());
    const staggerOnRef = useRef(staggerOn);
    useEffect(() => { staggerOnRef.current = staggerOn; }, [staggerOn]);

    // Release-event overlay toolbar state (req #2606). React shell owns the UI;
    // iframe owns the renderer. localStorage keeps the boot value stable so
    // standalone mode and embedded mode agree on first paint.
    const [showReleases, setShowReleases] = useState(() => readShowReleases());
    const [releaseStyle, setReleaseStyle] = useState(() => readReleaseStyle());
    const showReleasesRef = useRef(showReleases);
    const releaseStyleRef = useRef(releaseStyle);
    useEffect(() => { showReleasesRef.current = showReleases; }, [showReleases]);
    useEffect(() => { releaseStyleRef.current = releaseStyle; }, [releaseStyle]);

    // Dark variant + transport-aware theme (req #2621).
    //   • `darkVariant` is the user's chosen DARK theme. Default Charcoal.
    //     Only changes when the user picks from the menu (which is hidden
    //     unless the app is in dark mode).
    //   • The value actually posted to the iframe is `effectiveMode === 'dark'
    //     ? darkVariant : 'light'`. Switching Darwin's app mode automatically
    //     re-themes the canvas without touching the stored dark preference.
    const { effectiveMode } = useContext(ThemeContext);
    const [darkVariant, setDarkVariant] = useState(
        () => readStoredDarkVariant() || DEFAULT_DARK_VARIANT,
    );
    // Resolve once per render so both the postMessage effect and the ref
    // mirror agree on a single value.
    const iframeTheme = effectiveMode === 'dark' ? darkVariant : LIGHT_TRANSPORT_VARIANT;
    const iframeThemeRef = useRef(iframeTheme);
    useEffect(() => { iframeThemeRef.current = iframeTheme; }, [iframeTheme]);

    const changeDarkVariant = useCallback((variant) => {
        if (!isThemeVariant(variant)) return;
        setDarkVariant(variant);
        writeStoredDarkVariant(variant);
    }, []);

    const toggleType = useCallback((type) => {
        setSelectedTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    }, []);

    const postLoad = useCallback((data) => {
        const win = iframeRef.current?.contentWindow;
        if (!win || !data) return;
        win.postMessage({ type: 'bv:load', data }, window.location.origin);
    }, []);

    // Req #2648 — hand the iframe SQL credentials so its SqlBackedStorageAdapter
    // can fetch /build_projects + /branches + /builds for the active project
    // directly. No-op if the active pattern isn't a SQL-backed project (i.e.
    // there's no projectId).
    const postSqlInit = useCallback((projectId) => {
        const win = iframeRef.current?.contentWindow;
        if (!win || !projectId || !idToken || !darwinUri) return;
        win.postMessage(
            { type: 'bv:sql-init', idToken, darwinUri, projectId },
            window.location.origin,
        );
    }, [idToken, darwinUri]);

    // Req #2648 — finish the Perform Release Event flow. Posts the chosen
    // customer names back to the iframe so it can update model.releaseEvents.
    const postReleaseResult = useCallback((buildId, customerNames) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage(
            { type: 'bv:release-result', buildId, customers: customerNames },
            window.location.origin,
        );
    }, []);

    const postFilter = useCallback((selected) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        // Send the deselected types — the iframe hides ONLY the types listed
        // here, leaving any branch type not in the chip rail visible by
        // default. Keeps the iframe robust to REGISTRY entries added without
        // a corresponding chip.
        const hidden = BRANCH_TYPES.filter(t => !selected.includes(t));
        win.postMessage({ type: 'bv:filter', hidden }, window.location.origin);
    }, []);

    const postVersionLanes = useCallback((value) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: 'bv:set-version-lanes', value }, window.location.origin);
    }, []);

    const postTheme = useCallback((variant) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: 'bv:set-theme', variant }, window.location.origin);
    }, []);

    const postShowReleases = useCallback((value) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: 'bv:set-show-releases', value }, window.location.origin);
    }, []);

    const postReleaseStyle = useCallback((value) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: 'bv:set-release-style', value }, window.location.origin);
    }, []);

    const toggleStagger = useCallback(() => {
        setStaggerOn(prev => !prev);
    }, []);

    const toggleShowReleases = useCallback(() => {
        setShowReleases(prev => !prev);
    }, []);

    const changeReleaseStyle = useCallback((v) => {
        const num = Number(v);
        if (!Number.isInteger(num) || num < 1 || num > 5) return;
        setReleaseStyle(num);
    }, []);

    useEffect(() => {
        const onMessage = (e) => {
            if (e.origin !== window.location.origin) return;
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'bv:ready') {
                iframeReady.current = true;
                // Req #2648 — patterns are SQL-backed. Send credentials so the
                // iframe constructs its own SqlBackedStorageAdapter and fetches
                // /build_projects + /branches + /builds for the active project
                // directly. No bv:load is sent — the legacy in-memory pattern
                // flow is retired.
                if (lib.activePattern?.projectId) {
                    prevActiveIdRef.current = lib.activeId;
                    postSqlInit(lib.activePattern.projectId);
                }
                postFilter(selectedTypesRef.current);
                postVersionLanes(staggerOnRef.current);
                postTheme(iframeThemeRef.current);
                postShowReleases(showReleasesRef.current);
                postReleaseStyle(releaseStyleRef.current);
            } else if (msg.type === 'bv:release-overlay-state') {
                // Iframe announced its boot value. Adopt only when it differs
                // from the value we already hold so we don't re-render on echo.
                const nextShow = !!msg.showReleases;
                const v = Number(msg.releaseStyle);
                const nextStyle = Number.isInteger(v) && v >= 1 && v <= 5 ? v : 1;
                if (nextShow !== showReleasesRef.current) setShowReleases(nextShow);
                if (nextStyle !== releaseStyleRef.current) setReleaseStyle(nextStyle);
            } else if (msg.type === 'bv:changed') {
                // Req #2648 — iframe-side persistence is now direct to SQL via
                // SqlBackedStorageAdapter. The parent no longer needs to mirror
                // every mutation into localStorage; bv:changed is only emitted
                // for legacy/postMessage adapters which we no longer use here.
                // Kept as a no-op for protocol compatibility.
            } else if (msg.type === 'bv:release-prompt' && msg.buildId) {
                // Req #2648 — iframe asked the parent to run the customer-
                // selection Dialog. Open it. The Dialog's Confirm handler does
                // the POSTs and posts bv:release-result back.
                setReleaseDialog({ buildId: msg.buildId });
                setSelectedCustomerIds([]);
            } else if (msg.type === 'bv:version-lanes-state') {
                // Iframe announced its boot value (e.g. standalone mode flipped
                // localStorage from a different tab). Adopt it locally so the
                // Chip matches the renderer; the staggerOn effect persists.
                const next = !!msg.value;
                if (next !== staggerOnRef.current) setStaggerOn(next);
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [lib, postSqlInit, postFilter, postVersionLanes, postTheme, postShowReleases, postReleaseStyle]);

    // Push filter to iframe on every chip toggle (no-op until iframe is ready —
    // the bv:ready handler covers the initial post once the iframe boots).
    useEffect(() => {
        if (!iframeReady.current) return;
        postFilter(selectedTypes);
    }, [selectedTypes, postFilter]);

    // Persist Stagger state to localStorage whenever it changes. The first
    // run after mount re-writes the value we just READ from localStorage —
    // harmless and keeps the side effect out of the toggle callback.
    useEffect(() => {
        writeVersionLanes(staggerOn);
    }, [staggerOn]);

    // Push Stagger state to iframe on every toggle (no-op until iframe is
    // ready — the bv:ready handler covers the initial post once the iframe
    // boots).
    useEffect(() => {
        if (!iframeReady.current) return;
        postVersionLanes(staggerOn);
    }, [staggerOn, postVersionLanes]);

    // Req #2606 — persist + push release-overlay state on every change.
    useEffect(() => { writeShowReleases(showReleases); }, [showReleases]);
    useEffect(() => { writeReleaseStyle(releaseStyle); }, [releaseStyle]);
    useEffect(() => {
        if (!iframeReady.current) return;
        postShowReleases(showReleases);
    }, [showReleases, postShowReleases]);
    useEffect(() => {
        if (!iframeReady.current) return;
        postReleaseStyle(releaseStyle);
    }, [releaseStyle, postReleaseStyle]);

    // Push theme to iframe whenever the resolved value changes — either
    // because the user picked a different dark variant OR Darwin's app
    // theme flipped between light and dark (no-op until iframe is ready;
    // bv:ready covers the initial post once the iframe boots).
    useEffect(() => {
        if (!iframeReady.current) return;
        postTheme(iframeTheme);
    }, [iframeTheme, postTheme]);

    // Req #2648 — when the user switches the active pattern, send a fresh
    // bv:sql-init so the iframe rebuilds its SqlBackedStorageAdapter with the
    // new projectId and reloads. Subsequent in-pattern mutations are persisted
    // directly to SQL by the iframe (no parent-side echo needed).
    useEffect(() => {
        if (!iframeReady.current || !lib.activePattern?.projectId) return;
        if (prevActiveIdRef.current === lib.activeId) return;
        prevActiveIdRef.current = lib.activeId;
        postSqlInit(lib.activePattern.projectId);
    }, [lib.activeId, lib.activePattern, postSqlInit]);

    // ─── Perform Release Event Dialog handlers ───────────────────────────
    const selectedCustomers = useMemo(() => {
        const rows = customersQuery.data || [];
        return rows.filter(c => selectedCustomerIds.includes(Number(c.id)));
    }, [customersQuery.data, selectedCustomerIds]);

    const toggleCustomer = useCallback((id) => {
        const n = Number(id);
        setSelectedCustomerIds(prev =>
            prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n],
        );
    }, []);

    const confirmReleaseDialog = useCallback(async () => {
        if (!releaseDialog || !lib.activePattern?.projectId) {
            setReleaseDialog(null);
            return;
        }
        const buildExtId = releaseDialog.buildId;
        // Resolve the SQL build_fk by external_id within the active project.
        // Done as a one-off fetch — typical Perform-Release-Event flows are
        // rare enough not to warrant a permanent cached lookup.
        try {
            const branchesRes = await call_rest_api(
                `${darwinUri}/branches?project_fk=${lib.activePattern.projectId}`,
                'GET', '', idToken,
            );
            const branches = branchesRes?.data || [];
            const branchIds = branches.map(b => b.id).join(',');
            if (!branchIds) throw new Error('No branches for project');
            const buildsRes = await call_rest_api(
                `${darwinUri}/builds?branch_fk=(${branchIds})&external_id=${buildExtId}`,
                'GET', '', idToken,
            );
            const builds = buildsRes?.data || [];
            const sqlBuild = builds.find(b => b.external_id === buildExtId);
            if (!sqlBuild) throw new Error(`Build ${buildExtId} not found in SQL`);

            // POST one /customer_releases row per selected customer.
            for (const cust of selectedCustomers) {
                await call_rest_api(
                    `${darwinUri}/customer_releases`, 'POST',
                    {
                        customer_fk: cust.id,
                        build_fk: sqlBuild.id,
                    },
                    idToken,
                );
            }
            // Mark the build approved_for_release=1 (POSTing a release implies it).
            await call_rest_api(
                `${darwinUri}/builds`, 'PUT',
                [{ id: sqlBuild.id, approved_for_release: 1 }],
                idToken,
            );

            // Inform the iframe — pass the customer NAMES so model.releaseEvents
            // updates locally without a re-fetch.
            const names = selectedCustomers.map(c => c.customer_name || c.name || `customer-${c.id}`);
            postReleaseResult(buildExtId, names);
        } catch (err) {
            // Surface to console; the user can retry. A snackbar would be nice
            // but we don't have one wired at this level — out of v1 scope.
            console.error('[BuildVisualizer] Perform Release Event failed:', err);
        }
        setReleaseDialog(null);
        setSelectedCustomerIds([]);
    }, [releaseDialog, lib.activePattern, darwinUri, idToken, selectedCustomers, postReleaseResult]);

    const cancelReleaseDialog = useCallback(() => {
        setReleaseDialog(null);
        setSelectedCustomerIds([]);
    }, []);

    return (
        <Box
            sx={{
                gridArea: 'content',
                display: 'grid',
                gridTemplateRows: 'auto 1fr',
                height: '100vh',
                width: '100%',
                overflow: 'hidden',
            }}
        >
            <BuildVisualizerControls
                lib={lib}
                selectedTypes={selectedTypes}
                onToggleType={toggleType}
                staggerOn={staggerOn}
                onToggleStagger={toggleStagger}
                appMode={effectiveMode}
                darkVariant={darkVariant}
                onChangeDarkVariant={changeDarkVariant}
                showReleases={showReleases}
                onToggleShowReleases={toggleShowReleases}
                releaseStyle={releaseStyle}
                onChangeReleaseStyle={changeReleaseStyle}
            />
            {lib.isReady ? (
                <iframe
                    ref={iframeRef}
                    src="/build-visualizer/index.html"
                    title="Build Visualizer"
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                    data-testid="build-visualizer-iframe"
                />
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <CircularProgress />
                </Box>
            )}
            <Dialog
                open={!!releaseDialog}
                onClose={cancelReleaseDialog}
                data-testid="bv-release-event-dialog"
            >
                <DialogTitle>Perform release event</DialogTitle>
                <DialogContent>
                    <Box sx={{ minWidth: 320 }}>
                        <Box sx={{ mb: 1, fontSize: '0.9rem', color: 'text.secondary' }}>
                            Build: {releaseDialog?.buildId} — pick the customers receiving this build.
                        </Box>
                        {(customersQuery.data || []).map(c => (
                            <FormControlLabel
                                key={c.id}
                                control={(
                                    <Checkbox
                                        checked={selectedCustomerIds.includes(Number(c.id))}
                                        onChange={() => toggleCustomer(c.id)}
                                        data-testid={`bv-release-customer-${c.id}`}
                                    />
                                )}
                                label={c.customer_name || c.name || `customer-${c.id}`}
                                sx={{ display: 'block' }}
                            />
                        ))}
                        {(customersQuery.data || []).length === 0 && (
                            <Box sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                                No customers found — add some on /customers first.
                            </Box>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={cancelReleaseDialog}>Cancel</Button>
                    <Button
                        onClick={confirmReleaseDialog}
                        disabled={selectedCustomerIds.length === 0}
                        variant="contained"
                        data-testid="bv-release-event-confirm"
                    >
                        Release to selected
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default BuildVisualizerPage;
