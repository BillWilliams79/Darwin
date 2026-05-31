// Build Visualizer — the D3-based React implementation (req #2694 / #2720).
//
// Replaced the iframe-based visualizer in req #2720. State + toolbar wiring +
// Perform-Release-Event Dialog + build-dot context menu live here; the SVG
// canvas itself is delegated to BuildVisualizerCanvas.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Fade from '@mui/material/Fade';
import FormControlLabel from '@mui/material/FormControlLabel';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import BuildVisualizerControls from './BuildVisualizerControls';
import BuildVisualizerCanvas from './BuildVisualizerCanvas';
import HoldCountButton from './HoldCountButton';
import { useBuildPatterns } from './useBuildPatterns';
import { useBuildVisualizerData } from './useBuildVisualizerData';
import { BRANCH_TYPES, branchTypeLabel } from './branchTypeChipStyles';
import { REGISTRY } from './d3LayoutEngine';
import {
    nextBuildVersion,
    firstBuildOnNewBranchVersion,
    fromModelBuild,
    toBuildRow,
    isOpenMm,
    openMm,
    takesMainMm,
} from './versionEngine';
import {
    allowedChildTypes,
    canCreate,
    creationGate,
    GATE_BLOCK,
    GATE_CONFIRM,
} from './branchEngine';
import {
    DEFAULT_DARK_VARIANT,
    isThemeVariant,
} from './themeVariants';
import ThemeContext from '../Theme/ThemeContext';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';

// Press-and-hold tuning (req #2737, retimed req #2741). Builds cap at 14,
// branch-create (hotfix/bootleg/development only) at 5. The TIMING is shared.
const MAX_BUILDS_PER_HOLD = 14;
const MAX_BRANCHES_PER_HOLD = 5;
// Common hold-to-count timing for BOTH builds and branches (req #2741): one
// start delay + one dwell, only the cap differs. Derived from the prior branch
// cadence — start delay 2× the old 200 ms (the wait before the count leaves 1),
// dwell = the old branch dwell (2× builds = 450) made 25% longer.
const HOLD_START_DELAY_MS = 400;        // 2× the prior 200 ms
const HOLD_DWELL_MS = 450 * 1.25;       // 562.5 ms — 25% longer than the old branch dwell
// Only these branch types support hold-to-make-multiple; others are single.
const MULTI_BRANCH_TYPES = new Set(['hotfix', 'bootleg', 'development']);

// localStorage keys for user preferences.
const VERSION_LANES_STORAGE_KEY = 'darwin.buildVisualizer.versionLanes.v1';
const DARK_VARIANT_STORAGE_KEY = 'darwin.buildVisualizer.darkVariant.v1';
const SHOW_RELEASES_STORAGE_KEY = 'darwin.bv.showReleases';

const readShowReleases = () => {
    try {
        return window.localStorage.getItem(SHOW_RELEASES_STORAGE_KEY) !== 'off';
    } catch (_) { return true; }
};
const writeShowReleases = (value) => {
    try { window.localStorage.setItem(SHOW_RELEASES_STORAGE_KEY, value ? 'on' : 'off'); } catch (_) {}
};
const readVersionLanes = () => {
    try { return window.localStorage.getItem(VERSION_LANES_STORAGE_KEY) !== 'off'; } catch (_) { return true; }
};
const writeVersionLanes = (value) => {
    try { window.localStorage.setItem(VERSION_LANES_STORAGE_KEY, value ? 'on' : 'off'); } catch (_) {}
};
const readStoredDarkVariant = () => {
    try {
        const v = window.localStorage.getItem(DARK_VARIANT_STORAGE_KEY);
        return isThemeVariant(v) ? v : null;
    } catch (_) { return null; }
};
const writeStoredDarkVariant = (variant) => {
    try { window.localStorage.setItem(DARK_VARIANT_STORAGE_KEY, variant); } catch (_) {}
};

const BuildVisualizerPage = () => {
    const lib = useBuildPatterns();
    const projectId = lib.activePattern?.projectId || null;
    const { isLoading: dataLoading, error: dataError, model } = useBuildVisualizerData(projectId);

    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();

    // Customers — for the Perform-Release-Event Dialog.
    const customersQuery = useQuery({
        queryKey: ['customers', profile?.id],
        queryFn: () => fetchEntity(`${darwinUri}/customers`, idToken),
        enabled: !!idToken && !!profile?.id && !!darwinUri,
    });
    const [releaseDialog, setReleaseDialog] = useState(null);
    const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);

    // Branch-type chip rail.
    const [selectedTypes, setSelectedTypes] = useState(() => [...BRANCH_TYPES]);
    const toggleType = useCallback((type) => {
        setSelectedTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type],
        );
    }, []);

    // Stagger.
    const [staggerOn, setStaggerOn] = useState(() => readVersionLanes());
    const toggleStagger = useCallback(() => setStaggerOn(prev => !prev), []);
    useEffect(() => { writeVersionLanes(staggerOn); }, [staggerOn]);

    // "Reset view" — bump a nonce the canvas watches to re-frame on demand
    // (req #2741). Filter/stagger toggles preserve the user's pan; this is the
    // explicit re-center control.
    const [resetViewNonce, setResetViewNonce] = useState(0);
    const handleResetView = useCallback(() => setResetViewNonce(n => n + 1), []);

    // Release overlay — Gold Star only (req #2741; the style picker + Chip Row
    // were removed). Toggle just shows/hides the overlay.
    const [showReleases, setShowReleases] = useState(() => readShowReleases());
    const toggleShowReleases = useCallback(() => setShowReleases(prev => !prev), []);
    useEffect(() => { writeShowReleases(showReleases); }, [showReleases]);

    // Theme — dark-variant handling.
    const { effectiveMode } = useContext(ThemeContext);
    const [darkVariant, setDarkVariant] = useState(
        () => readStoredDarkVariant() || DEFAULT_DARK_VARIANT,
    );
    const changeDarkVariant = useCallback((variant) => {
        if (!isThemeVariant(variant)) return;
        setDarkVariant(variant);
        writeStoredDarkVariant(variant);
    }, []);

    // ─── Build-dot menu (req #2737) ────────────────────────────────────
    // Opens on HOVER over a build. Build Info Card header + Execute Build +
    // Production Ready two-state toggle + (if approved) release event + a flat
    // list of every legal child branch (BranchEngine §4.7) as one-click buttons.
    const [dotMenu, setDotMenu] = useState(null); // { buildRecord, mouseX, mouseY }

    // The anchorEl for the Menu needs to be a real DOM element. Since the click
    // comes from an SVG element (which MUI Menu can't anchor to reliably), we
    // use anchorPosition instead, derived from the mouse event coordinates.
    const dotMenuPosition = dotMenu
        ? { top: dotMenu.mouseY, left: dotMenu.mouseX }
        : undefined;

    // Hover-bridge close timer (req #2741). The menu opens on dot hover and the
    // popup sits a hair away from the dot, so leaving the dot OR the popup
    // schedules a short-delay close; entering the popup (or hovering another
    // dot) cancels it. This lets the cursor travel dot→popup without flicker
    // while guaranteeing the menu closes whenever the cursor rests on neither.
    const dotCloseTimerRef = useRef(null);
    const cancelCloseDotMenu = useCallback(() => {
        if (dotCloseTimerRef.current) {
            clearTimeout(dotCloseTimerRef.current);
            dotCloseTimerRef.current = null;
        }
    }, []);

    const handleBuildClick = useCallback((buildRecord, e) => {
        // `e` is the React SyntheticEvent from the SVG hover/click. Use its
        // clientX/clientY for menu positioning.
        cancelCloseDotMenu(); // moving onto a dot cancels any pending close
        setDotMenu({
            buildRecord,
            mouseX: e.clientX,
            mouseY: e.clientY,
        });
    }, [cancelCloseDotMenu]);

    const closeDotMenu = useCallback(() => {
        cancelCloseDotMenu();
        setDotMenu(null);
    }, [cancelCloseDotMenu]);

    const scheduleCloseDotMenu = useCallback(() => {
        cancelCloseDotMenu();
        dotCloseTimerRef.current = setTimeout(() => {
            dotCloseTimerRef.current = null;
            setDotMenu(null);
        }, 150);
    }, [cancelCloseDotMenu]);

    // Clear the pending close timer on unmount.
    useEffect(() => cancelCloseDotMenu, [cancelCloseDotMenu]);

    // Close any open build (dot) menu when the active project changes (req
    // #2741). The menu is anchored to a build that belongs to the old project;
    // leaving it open after a switch/create strands a popup over unrelated data.
    useEffect(() => {
        setDotMenu(null);
        setBranchEditor(null);
    }, [projectId]);

    // Look up the branch object for the clicked build.
    const dotMenuBranch = useMemo(() => {
        if (!dotMenu || !model?.branches) return null;
        return model.branches.find(b => b.id === dotMenu.buildRecord.branchId) || null;
    }, [dotMenu, model]);

    // Resolve the SQL branch id for the clicked build's branch. We need this
    // for POST /builds (adding a build) and POST /branches (creating a branch).
    const branchSqlIdRef = useRef(new Map());
    useEffect(() => {
        // Maintain a mapping of external_id -> SQL id from the data hook's raw
        // query cache. We re-derive this when the model changes.
        if (!model?.branches) return;
        const cache = queryClient.getQueryData(
            ['bv-d3-branches', profile?.id, projectId],
        );
        if (!Array.isArray(cache)) return;
        const m = new Map();
        for (const row of cache) {
            if (row.external_id) m.set(row.external_id, Number(row.id));
        }
        branchSqlIdRef.current = m;
    }, [model, queryClient, profile?.id, projectId]);

    // Similarly for builds: external_id -> SQL row.
    const buildSqlIdRef = useRef(new Map());
    useEffect(() => {
        if (!model?.builds) return;
        const branchIdsCsv = (Array.isArray(queryClient.getQueryData(['bv-d3-branches', profile?.id, projectId]))
            ? queryClient.getQueryData(['bv-d3-branches', profile?.id, projectId])
            : []).map(b => b.id).filter(Number.isFinite).join(',');
        const cache = queryClient.getQueryData(
            ['bv-d3-builds', profile?.id, projectId, branchIdsCsv],
        );
        if (!Array.isArray(cache)) return;
        const m = new Map();
        for (const row of cache) {
            if (row.external_id) m.set(row.external_id, row);
        }
        buildSqlIdRef.current = m;
    }, [model, queryClient, profile?.id, projectId]);

    const invalidateBuildData = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['bv-d3-branches'] });
        queryClient.invalidateQueries({ queryKey: ['bv-d3-builds'] });
        queryClient.invalidateQueries({ queryKey: ['bv-d3-customer-releases'] });
    }, [queryClient]);

    // ─── Assign-M.m prompt (req #2737, §4.2) ───────────────────────────────
    // Shown when a branch needs a Major.Minor it doesn't have: after a release
    // hands main's M.m away (main is left open), or when a build is attempted
    // on an open branch. There is NO auto-assign — the value is the user's, and
    // the dialog cannot be confirmed without a valid (M ≥ 0, m ≥ 0).
    const [versionPrompt, setVersionPrompt] = useState(null); // { sqlId, label }
    const [vpMajor, setVpMajor] = useState('');
    const [vpMinor, setVpMinor] = useState('');
    const openVersionPrompt = useCallback((sqlId, label) => {
        setVpMajor('');
        setVpMinor('');
        setVersionPrompt({ sqlId, label });
    }, []);
    const vpValid = (() => {
        const M = parseInt(vpMajor, 10);
        const m = parseInt(vpMinor, 10);
        return Number.isFinite(M) && M >= 0 && Number.isFinite(m) && m >= 0;
    })();
    const confirmVersionPrompt = useCallback(async () => {
        if (!versionPrompt) return;
        const major = parseInt(vpMajor, 10);
        const minor = parseInt(vpMinor, 10);
        if (!Number.isFinite(major) || major < 0 || !Number.isFinite(minor) || minor < 0) return;
        try {
            await call_rest_api(
                `${darwinUri}/branches`, 'PUT',
                [{ id: versionPrompt.sqlId, major, minor }],
                idToken,
            );
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Assign Major.Minor failed:', err);
        }
        setVersionPrompt(null);
    }, [versionPrompt, vpMajor, vpMinor, darwinUri, idToken, invalidateBuildData]);

    // ─── Branch editor (req #2741) ───────────────────────────────────────
    // Clicking a branch name label (including main's trunk label) opens this
    // editor: set the branch name and review the branch's info. PUT /branches
    // persists the rename through the same path as other branch mutations.
    const [branchEditor, setBranchEditor] = useState(null); // { branchId }
    const [beName, setBeName] = useState('');
    const branchEditorBranch = useMemo(
        () => (branchEditor && model?.branches)
            ? model.branches.find(b => b.id === branchEditor.branchId) || null
            : null,
        [branchEditor, model],
    );
    const handleBranchClick = useCallback((branchId) => {
        const br = model?.branches?.find(b => b.id === branchId);
        if (!br) return;
        setBeName(br.name || '');
        setBranchEditor({ branchId });
    }, [model]);
    const closeBranchEditor = useCallback(() => setBranchEditor(null), []);
    const beValid = beName.trim().length > 0;
    const confirmBranchEditor = useCallback(async () => {
        if (!branchEditor || beName.trim().length === 0) return;
        const sqlId = branchSqlIdRef.current.get(branchEditor.branchId);
        if (!sqlId) { setBranchEditor(null); return; }
        try {
            await call_rest_api(
                `${darwinUri}/branches`, 'PUT',
                [{ id: sqlId, name: beName.trim() }],
                idToken,
            );
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Rename branch failed:', err);
        }
        setBranchEditor(null);
    }, [branchEditor, beName, darwinUri, idToken, invalidateBuildData]);

    // Execute `count` builds in a row on the clicked build's branch (req #2737 —
    // press-and-hold "Execute Build" ramps count up to MAX_BUILDS_PER_HOLD). A
    // plain click is count=1. The whole version sequence is computed locally
    // via the VersionEngine (each build feeds the next), so all POSTs fire in
    // parallel — distinct positions keep UNIQUE(branch_fk, position) happy.
    const executeBuilds = useCallback(async (count) => {
        const n = Math.max(1, Math.min(MAX_BUILDS_PER_HOLD, Math.floor(count) || 1));
        if (!dotMenu || !dotMenuBranch) { closeDotMenu(); return; }
        const branchSqlId = branchSqlIdRef.current.get(dotMenuBranch.id);
        if (!branchSqlId) { closeDotMenu(); return; }

        // Version gate (§4.2): refuse on an open branch and prompt for M.m.
        const branchMm = { major: dotMenuBranch.major, minor: dotMenuBranch.minor };
        if (isOpenMm(branchMm)) {
            closeDotMenu();
            openVersionPrompt(branchSqlId, dotMenuBranch.name || 'Main');
            return;
        }

        const existingPositions = (dotMenuBranch.buildIds || []).map(bid => {
            const b = model.builds[bid];
            return b ? b.position : -1;
        });
        let nextPosition = existingPositions.length > 0
            ? Math.max(...existingPositions) + 1
            : 0;
        const lastBuildId = dotMenuBranch.buildIds?.[dotMenuBranch.buildIds.length - 1];
        let lastBuild = fromModelBuild(lastBuildId ? model.builds[lastBuildId] : null);

        const posts = [];
        for (let i = 0; i < n; i++) {
            const v = nextBuildVersion({ branchType: dotMenuBranch.type, lastBuild, branchMm });
            const pos = nextPosition + i;
            posts.push(call_rest_api(
                `${darwinUri}/builds`, 'POST',
                {
                    branch_fk: branchSqlId,
                    position: pos,
                    ...toBuildRow(v),
                    external_id: `${dotMenuBranch.id}-b${pos + 1}`,
                },
                idToken,
            ));
            lastBuild = v; // next build increments from this one
        }
        try {
            await Promise.all(posts);
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Execute builds failed:', err);
        }
        closeDotMenu();
    }, [dotMenu, dotMenuBranch, model, darwinUri, idToken, closeDotMenu, invalidateBuildData, openVersionPrompt]);

    const handleCreateBranch = useCallback(async (type, count = 1) => {
        if (!dotMenu || !projectId) { closeDotMenu(); return; }
        // BranchEngine policy gate (§4.7). Submenu already filters to allowed
        // types; this guards programmatic / stale calls too. Multi-create is
        // only offered for MULTI_BRANCH_TYPES; clamp accordingly.
        const parentType = dotMenuBranch?.type || 'main';
        if (!canCreate(parentType, type).allowed) { closeDotMenu(); return; }
        const gate = creationGate(type, dotMenu.buildRecord);
        if (gate.action === GATE_BLOCK) { closeDotMenu(); return; }
        if (gate.action === GATE_CONFIRM && !window.confirm(gate.message)) { closeDotMenu(); return; }
        const n = MULTI_BRANCH_TYPES.has(type)
            ? Math.max(1, Math.min(MAX_BRANCHES_PER_HOLD, Math.floor(count) || 1))
            : 1;
        const buildExtId = dotMenu.buildRecord.id;
        const buildSqlRow = buildSqlIdRef.current.get(buildExtId);
        if (!buildSqlRow) { closeDotMenu(); return; }
        const parentBuildSqlId = buildSqlRow.id || buildSqlRow;
        const label = REGISTRY[type]?.label || type;
        const parentBuild = fromModelBuild(model.builds?.[buildExtId]);
        // Sibling ordinal base — each new branch in this batch is the next
        // same-type sibling off this parent build, so Branch# walks the
        // reserved range (e.g. hotfix 6000, 6050, 6100 …).
        const baseOrd0 = (model.branches || [])
            .filter(b => b.parentBuildId === buildExtId && b.type === type).length;
        const stamp = Date.now();

        // `release` carries main's M.m away (§4.2). release isn't a multi type,
        // so n === 1 here; the handoff runs once after creation.
        const mainSqlId = branchSqlIdRef.current.get('main');
        const doHandoff = takesMainMm(type) && mainSqlId;

        // One independent POST-branch → POST-its-first-build chain per branch;
        // run them in parallel (distinct external_ids + Branch#s).
        const chains = Array.from({ length: n }, (_, i) => (async () => {
            const v = firstBuildOnNewBranchVersion({ type, parentBuild, siblingOrd0: baseOrd0 + i });
            const slug = `${type}-${stamp}-${i}`;
            const branchRes = await call_rest_api(
                `${darwinUri}/branches`, 'POST',
                {
                    project_fk: projectId,
                    branch_type: type,
                    name: label,
                    major: v.major,
                    minor: v.minor,
                    parent_build_fk: Number(parentBuildSqlId),
                    external_id: slug,
                    side: REGISTRY[type]?.defaultSide || 'above',
                },
                idToken,
            );
            const branch = branchRes?.data;
            const newBranchId = Array.isArray(branch) ? branch[0]?.id : branch?.id;
            if (newBranchId) {
                await call_rest_api(
                    `${darwinUri}/builds`, 'POST',
                    {
                        branch_fk: newBranchId,
                        position: 0,
                        ...toBuildRow(v),
                        external_id: `${slug}-b1`,
                    },
                    idToken,
                );
            }
        })());

        try {
            await Promise.all(chains);
            if (doHandoff) {
                // Set main open — next build refused until the user assigns M.m.
                const open = openMm();
                await call_rest_api(
                    `${darwinUri}/branches`, 'PUT',
                    [{ id: mainSqlId, major: open.major, minor: open.minor }],
                    idToken,
                );
                // Prompt ONLY after the open-PUT actually succeeded — otherwise a
                // failed release-create would pop a dialog that overwrites main's
                // still-valid M.m on confirm.
                openVersionPrompt(mainSqlId, 'Main');
            }
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Create branch failed:', err);
        }
        closeDotMenu();
    }, [dotMenu, dotMenuBranch, projectId, model, darwinUri, idToken, closeDotMenu, invalidateBuildData, openVersionPrompt]);

    const handleToggleApproved = useCallback(async () => {
        if (!dotMenu) return;
        const buildExtId = dotMenu.buildRecord.id;
        const buildSqlRow = buildSqlIdRef.current.get(buildExtId);
        if (!buildSqlRow) return;
        const sqlId = buildSqlRow.id || buildSqlRow;
        const newVal = !dotMenu.buildRecord.approvedForRelease;
        // Optimistically flip the open popover's state so the Switch + the
        // release-event item update in place — the popover STAYS OPEN (req #2737).
        setDotMenu(prev => (prev && prev.buildRecord.id === buildExtId
            ? { ...prev, buildRecord: { ...prev.buildRecord, approvedForRelease: newVal } }
            : prev));
        try {
            await call_rest_api(
                `${darwinUri}/builds`, 'PUT',
                [{ id: Number(sqlId), approved_for_release: newVal ? 1 : 0 }],
                idToken,
            );
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Toggle approved failed:', err);
        }
    }, [dotMenu, darwinUri, idToken, invalidateBuildData]);

    const handlePerformReleaseEvent = useCallback(() => {
        if (!dotMenu) return;
        setReleaseDialog({ buildId: dotMenu.buildRecord.id });
        setSelectedCustomerIds([]);
        closeDotMenu();
    }, [dotMenu, closeDotMenu]);

    // Branch types available for the "Create branch" submenu — driven by the
    // BranchEngine matrix (§4.7) from the clicked build's branch type.
    const branchSubtypes = useMemo(
        () => allowedChildTypes(dotMenuBranch?.type || 'main'),
        [dotMenuBranch],
    );

    // ─── Perform Release Event Dialog ────────────────────────────────────

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
            for (const cust of selectedCustomers) {
                await call_rest_api(
                    `${darwinUri}/customer_releases`, 'POST',
                    { customer_fk: cust.id, build_fk: sqlBuild.id },
                    idToken,
                );
            }
            await call_rest_api(
                `${darwinUri}/builds`, 'PUT',
                [{ id: sqlBuild.id, approved_for_release: 1 }],
                idToken,
            );
            // Refresh the local data so the new event renders immediately.
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Perform Release Event failed:', err);
        }
        setReleaseDialog(null);
        setSelectedCustomerIds([]);
    }, [releaseDialog, lib.activePattern, darwinUri, idToken, selectedCustomers, invalidateBuildData]);

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
                onResetView={handleResetView}
                appMode={effectiveMode}
                darkVariant={darkVariant}
                onChangeDarkVariant={changeDarkVariant}
                showReleases={showReleases}
                onToggleShowReleases={toggleShowReleases}
            />
            <BuildVisualizerCanvas
                model={model}
                projectId={projectId}
                isLoading={dataLoading || !lib.isReady}
                error={dataError || lib.error}
                selectedTypes={selectedTypes}
                staggerOn={staggerOn}
                showReleases={showReleases}
                appMode={effectiveMode}
                darkVariant={darkVariant}
                onBuildClick={handleBuildClick}
                onBuildLeave={scheduleCloseDotMenu}
                onBranchClick={handleBranchClick}
                resetViewNonce={resetViewNonce}
            />

            {/* ─── Build-dot menu — non-modal hover Popover (req #2737) ─── */}
            <Popover
                open={!!dotMenu}
                onClose={closeDotMenu}
                anchorReference="anchorPosition"
                anchorPosition={dotMenuPosition}
                // Pin top-left to the cursor so content growth (toggling the
                // release item) extends DOWN/RIGHT and the corner never moves —
                // no wiggle (req #2737).
                anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                marginThreshold={0}
                hideBackdrop
                disableScrollLock
                disableAutoFocus
                disableEnforceFocus
                disableRestoreFocus
                // Fade, not the default Grow/scale — a scale animates the size
                // and reads as wiggle. Opacity-only = stable position + fade in.
                slots={{ transition: Fade }}
                slotProps={{
                    transition: { timeout: 140 },
                    paper: {
                        onMouseEnter: cancelCloseDotMenu,
                        onMouseLeave: scheduleCloseDotMenu,
                        sx: { pointerEvents: 'auto' },
                    },
                }}
                sx={{ pointerEvents: 'none' }}
                data-testid="bv-build-menu"
            >
                {/* Build Info Card */}
                <Box sx={{ px: 2, pt: 1, pb: 0.5, pointerEvents: 'none' }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                        Build {dotMenu?.buildRecord?.version}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                        {dotMenuBranch ? String(dotMenuBranch.name).replace(/\n/g, ' / ') : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                        {(() => {
                            const ts = dotMenu && model?.builds?.[dotMenu.buildRecord.id]?.createdAt;
                            return ts ? new Date(ts).toLocaleString() : '—';
                        })()}
                    </Typography>
                </Box>
                <Divider />

                <HoldCountButton
                    label="Execute Build"
                    onExecute={executeBuilds}
                    maxQty={MAX_BUILDS_PER_HOLD}
                    dwellMs={HOLD_DWELL_MS}
                    startDelayMs={HOLD_START_DELAY_MS}
                    data-testid="bv-menu-add-build"
                />

                {/* Production Ready — two-state toggle (req #2737). Off = not
                    production ready (default); On = production ready. */}
                <MenuItem onClick={handleToggleApproved} data-testid="bv-menu-approve">
                    <FormControlLabel
                        sx={{ m: 0, pointerEvents: 'none' }}
                        control={(
                            <Switch
                                size="small"
                                checked={!!dotMenu?.buildRecord?.approvedForRelease}
                                tabIndex={-1}
                                inputProps={{ readOnly: true, 'data-testid': 'bv-menu-approve-switch' }}
                            />
                        )}
                        label="Production Ready"
                    />
                </MenuItem>

                {dotMenu?.buildRecord?.approvedForRelease && (
                    <MenuItem onClick={handlePerformReleaseEvent} data-testid="bv-menu-release-prompt">
                        Perform release event…
                    </MenuItem>
                )}

                <Divider />
                <ListSubheader
                    disableSticky
                    sx={{
                        bgcolor: 'transparent',
                        lineHeight: 1.8,
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                    }}
                >
                    Create branch
                </ListSubheader>
                {branchSubtypes.length === 0 && (
                    <MenuItem disabled>No branches allowed here</MenuItem>
                )}
                {branchSubtypes.map(t => (
                    MULTI_BRANCH_TYPES.has(t)
                        ? (
                            <HoldCountButton
                                key={t}
                                label={branchTypeLabel(t)}
                                onExecute={(n) => handleCreateBranch(t, n)}
                                maxQty={MAX_BRANCHES_PER_HOLD}
                                dwellMs={HOLD_DWELL_MS}
                                startDelayMs={HOLD_START_DELAY_MS}
                                data-testid={`bv-menu-branch-${t}`}
                            />
                        )
                        : (
                            <MenuItem
                                key={t}
                                onClick={() => handleCreateBranch(t)}
                                data-testid={`bv-menu-branch-${t}`}
                            >
                                {branchTypeLabel(t)}
                            </MenuItem>
                        )
                ))}
            </Popover>

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

            {/* Assign-M.m prompt (req #2737, §4.2). Required — no auto-assign;
                Cancel leaves the branch open and the next build is refused. */}
            <Dialog
                open={!!versionPrompt}
                onClose={() => setVersionPrompt(null)}
                data-testid="bv-version-prompt"
            >
                <DialogTitle>Assign Major.Minor for “{versionPrompt?.label}”</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 1.5 }}>
                        This branch has no version. Set its Major.Minor before its
                        next build — the build cannot proceed without it.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            label="Major"
                            type="number"
                            autoFocus
                            margin="dense"
                            value={vpMajor}
                            onChange={(e) => setVpMajor(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && vpValid) confirmVersionPrompt(); }}
                            inputProps={{ min: 0, step: 1, 'data-testid': 'bv-version-major' }}
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            label="Minor"
                            type="number"
                            margin="dense"
                            value={vpMinor}
                            onChange={(e) => setVpMinor(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && vpValid) confirmVersionPrompt(); }}
                            inputProps={{ min: 0, step: 1, 'data-testid': 'bv-version-minor' }}
                            sx={{ flex: 1 }}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setVersionPrompt(null)}>Cancel</Button>
                    <Button
                        onClick={confirmVersionPrompt}
                        disabled={!vpValid}
                        variant="contained"
                        data-testid="bv-version-confirm"
                    >
                        Assign
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ─── Branch editor — name + info (req #2741) ─── */}
            <Dialog
                open={!!branchEditor}
                onClose={closeBranchEditor}
                data-testid="bv-branch-editor"
            >
                <DialogTitle>Edit branch</DialogTitle>
                <DialogContent>
                    <TextField
                        label="Branch name"
                        autoFocus
                        fullWidth
                        margin="dense"
                        value={beName}
                        onChange={(e) => setBeName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && beValid) confirmBranchEditor(); }}
                        inputProps={{ 'data-testid': 'bv-branch-name-input' }}
                    />
                    {branchEditorBranch && (
                        <Box sx={{ mt: 1.5 }}>
                            <Typography variant="caption" color="text.secondary" display="block">
                                Type: {branchEditorBranch.type}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block">
                                Version: {branchEditorBranch.major < 0
                                    ? 'open (no Major.Minor)'
                                    : `${branchEditorBranch.major}.${branchEditorBranch.minor}`}
                            </Typography>
                            {branchEditorBranch.parentBranchId && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                    Branched from: {model?.branches?.find(b => b.id === branchEditorBranch.parentBranchId)?.name
                                        || branchEditorBranch.parentBranchId}
                                </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary" display="block">
                                Builds: {branchEditorBranch.buildIds?.length || 0}
                            </Typography>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeBranchEditor}>Cancel</Button>
                    <Button
                        onClick={confirmBranchEditor}
                        disabled={!beValid}
                        variant="contained"
                        data-testid="bv-branch-save"
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default BuildVisualizerPage;
