// Build Visualizer — the D3-based React implementation (req #2694 / #2720).
//
// Build Visualizer page (req #2720 React + D3 engine). State + toolbar wiring +
// Perform-Release-Event Dialog + build-dot context menu live here; the SVG
// canvas itself is delegated to BuildVisualizerCanvas.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
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
import { hasMergeRules } from './mergeEngine';
import { REGISTRY } from './d3LayoutEngine';
import {
    nextBuildVersion,
    firstBuildOnNewBranchVersion,
    fromModelBuild,
    formatVersion,
    toBuildRow,
    isOpenMm,
    openMm,
    takesMainMm,
    suggestFirstBranchNumber,
    usedBranchNumbersFor,
} from './versionEngine';
import {
    allowedChildTypes,
    canCreate,
    creationGate,
    needsBranchNumberPrompt,
    GATE_BLOCK,
    GATE_CONFIRM,
} from './branchEngine';
import {
    DEFAULT_DARK_VARIANT,
    isThemeVariant,
} from './themeVariants';
import { canDeleteBuild, canDeleteBranch } from './deleteRules';
import { readinessLabelFor } from './readinessRules';
import { formatBranchLocation } from './buildLocation';
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
// dwell = the inter-increment step, decreased ~33% from the prior 562.5 ms so the
// count ramps faster while the start-delay offset is unchanged.
const HOLD_START_DELAY_MS = 400;        // 2× the prior 200 ms (offset before count leaves 1)
const HOLD_DWELL_MS = 375;              // ~33% faster than the prior 562.5 ms (= 562.5 × ⅔)
// Only these branch types support hold-to-make-multiple; others are single.
const MULTI_BRANCH_TYPES = new Set(['hotfix', 'bootleg', 'development']);

// localStorage keys for user preferences.
const VERSION_LANES_STORAGE_KEY = 'darwin.buildVisualizer.versionLanes.v1';
const DARK_VARIANT_STORAGE_KEY = 'darwin.buildVisualizer.darkVariant.v1';
const SHOW_RELEASES_STORAGE_KEY = 'darwin.bv.showReleases';
// req #2603 — Merge display (per-branch merge arrows + day-zero declarations) is
// DISPLAY-ONLY and NOT retained: it lives in in-session React state only, starts
// empty, and clears on project switch / reload. No localStorage.

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
    // Active project's display name — used to compose the branch-location
    // string shown on build/branch click (req #2753).
    const projectName = lib.activePattern?.name || '';
    const { isLoading: dataLoading, error: dataError, model } = useBuildVisualizerData(projectId);

    // Version of a branch's FIRST build (req #2753). The branch-location string
    // identifies the branch, so it is the same for the branch and every build
    // on it — always the first build's M.m.B.b. Empty when the branch has no
    // builds yet. `buildIds` is ordered by position (see useBuildVisualizerData).
    const branchFirstBuildVersion = useCallback((branch) => {
        const firstId = branch?.buildIds?.[0];
        const firstBuild = firstId ? model?.builds?.[firstId] : null;
        return firstBuild ? formatVersion(fromModelBuild(firstBuild)) : '';
    }, [model]);

    // Build Visualizer is a dev-only tool pinned to `darwin_dev` (req #2760).
    const { darwinBuildVizUri: darwinUri } = useContext(AppContext);
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

    // Delete confirmation dialog (req #2742). A single dialog driven by a state
    // object replaces both window.confirm calls. Everything needed to display the
    // message AND execute the delete is snapshot at open time so the originating
    // popover/editor can close immediately. The preview box mirrors TaskDeleteDialog:
    // generic prompt + bordered preview rendering the item with context.
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    // shape (build): { kind:'build', sqlId, version, branchName, releaseEventCount, approvedForRelease }
    // shape (branch): { kind:'branch', sqlId, branchName, typeLabel, buildCount, releaseEventCount }

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
    // explicit re-center control. The handler also clears all merge display
    // (req #2603 follow-up) — see handleResetView below the merge state.
    const [resetViewNonce, setResetViewNonce] = useState(0);

    // Release overlay — Gold Star only (req #2741; the style picker + Chip Row
    // were removed). Toggle just shows/hides the overlay.
    const [showReleases, setShowReleases] = useState(() => readShowReleases());
    const toggleShowReleases = useCallback(() => setShowReleases(prev => !prev), []);
    useEffect(() => { writeShowReleases(showReleases); }, [showReleases]);

    // ─── Merge engine (req #2603) ───────────────────────────────────────
    // DISPLAY-ONLY, not retained. Merges are toggled PER BRANCH: an in-session
    // set of branch extIds whose standard required/evaluate arrows show (toggled
    // from the branch editor + build-dot menu). Day-zero arrows are independent
    // (render regardless of the per-branch set). Both start empty and clear on
    // project switch — no persistence.
    const [mergeBranchIds, setMergeBranchIds] = useState([]);
    const [dayZeroIds, setDayZeroIds] = useState([]);
    useEffect(() => { setMergeBranchIds([]); setDayZeroIds([]); }, [projectId]);
    const mergeBranchSet = useMemo(() => new Set(mergeBranchIds), [mergeBranchIds]);
    const dayZeroSet = useMemo(() => new Set(dayZeroIds), [dayZeroIds]);
    const toggleMergeBranch = useCallback((branchExtId) => {
        if (!branchExtId) return;
        setMergeBranchIds(prev => prev.includes(branchExtId)
            ? prev.filter(x => x !== branchExtId)
            : [...prev, branchExtId]);
    }, []);
    const toggleDayZero = useCallback((buildExtId) => {
        if (!buildExtId) return;
        setDayZeroIds(prev => prev.includes(buildExtId)
            ? prev.filter(x => x !== buildExtId)
            : [...prev, buildExtId]);
    }, []);

    // "Reset view" re-frames the canvas AND hides every merge currently showing
    // — both the per-branch required/evaluate arrows and the day-zero red arrows
    // (req #2603 follow-up).
    const handleResetView = useCallback(() => {
        setResetViewNonce(n => n + 1);
        setMergeBranchIds([]);
        setDayZeroIds([]);
    }, []);

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

    // Empty-branch anchor click — opens the dot menu in "empty anchor" mode:
    // only Execute Build is shown (no buildRecord exists).
    const handleEmptyAnchorClick = useCallback((branchId, e) => {
        cancelCloseDotMenu();
        setDotMenu({
            emptyBranchId: branchId,
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
        setSampleBranchNumPrompt(null);
        // Also drop the delete-confirm dialog: it snapshots a SQL id from the
        // outgoing project, so leaving it open across a switch would let its
        // confirm fire a DELETE against an entity no longer on screen (req #2742).
        setDeleteConfirm(null);
    }, [projectId]);

    // Look up the branch object for the clicked build (or empty anchor).
    const dotMenuBranch = useMemo(() => {
        if (!dotMenu || !model?.branches) return null;
        if (dotMenu.emptyBranchId) {
            return model.branches.find(b => b.id === dotMenu.emptyBranchId) || null;
        }
        if (!dotMenu.buildRecord) return null;
        return model.branches.find(b => b.id === dotMenu.buildRecord.branchId) || null;
    }, [dotMenu, model]);

    // True when the dot menu is open in empty-anchor mode (no builds on branch).
    const isEmptyAnchorMenu = !!dotMenu?.emptyBranchId;

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

    // ─── Sprint branch-number prompt (req #2742) ────────────────────────
    // When a sample-release is created off a release parent, both share the
    // same reserved Branch# range + the same frozen Build#, so the default
    // first Branch# collides. This prompt lets the user choose a free one.
    const [sampleBranchNumPrompt, setSampleBranchNumPrompt] = useState(null);
    // shape: { type, parentBuildExtId, parentBuildSqlId, projectId, parentBranchName,
    //          frozen: {major,minor,build}, suggested, used: [...] }
    const [sbnValue, setSbnValue] = useState('');

    const sbnParsed = parseInt(sbnValue, 10);
    const sbnValid = Number.isFinite(sbnParsed) && sbnParsed >= 1;
    const sbnInUse = sbnValid && sampleBranchNumPrompt?.used?.includes(sbnParsed);

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

    // ─── Execute builds on an EMPTY branch (req #2742) ──────────────────
    // The branch exists but has zero builds. The first build uses the branch's
    // frozen/current version (same as doCreateBranch would), and subsequent
    // builds in a hold-to-N walk via nextBuildVersion from that seed.
    const executeBuildsOnEmptyBranch = useCallback(async (count) => {
        const n = Math.max(1, Math.min(MAX_BUILDS_PER_HOLD, Math.floor(count) || 1));
        if (!dotMenu?.emptyBranchId || !dotMenuBranch) { closeDotMenu(); return; }
        const branch = dotMenuBranch;
        const branchSqlId = branchSqlIdRef.current.get(branch.id);
        if (!branchSqlId) { closeDotMenu(); return; }

        // Resolve the first-build version based on branch type.
        let firstVersion;
        if (branch.type === 'main') {
            // Main — use nextBuildVersion with no lastBuild.
            const branchMm = { major: branch.major, minor: branch.minor };
            if (isOpenMm(branchMm)) {
                closeDotMenu();
                openVersionPrompt(branchSqlId, branch.name || 'Main');
                return;
            }
            firstVersion = nextBuildVersion({ branchType: 'main', lastBuild: null, branchMm });
        } else {
            // Sub-branch — use firstBuildOnNewBranchVersion with parent build.
            const parentBuild = fromModelBuild(
                branch.parentBuildId ? model.builds?.[branch.parentBuildId] : null,
            );
            if (!parentBuild) { closeDotMenu(); return; }

            const parentBranch = model.branches?.find(b => b.id === branch.parentBranchId);
            const parentBranchType = parentBranch?.type || 'main';

            // Sprint-branch-number prompt gate: sample-release off release parent.
            if (needsBranchNumberPrompt({ childType: branch.type, parentBranchType })) {
                const suggested = suggestFirstBranchNumber({ parentBuild, builds: model.builds });
                const used = usedBranchNumbersFor({ parentBuild, builds: model.builds });
                const parentBranchName = String(parentBranch?.name || parentBranchType).replace(/\n/g, ' / ');
                setSbnValue(String(suggested));
                setSampleBranchNumPrompt({
                    type: branch.type,
                    parentBuildExtId: branch.parentBuildId,
                    parentBuildSqlId: buildSqlIdRef.current.get(branch.parentBuildId)?.id
                        || buildSqlIdRef.current.get(branch.parentBuildId),
                    projectId,
                    parentBranchName,
                    frozen: {
                        major: parentBuild.major ?? 0,
                        minor: parentBuild.minor ?? 0,
                        build: parentBuild.build ?? 0,
                    },
                    suggested,
                    used,
                    parentBuild,
                    baseOrd0: 0,
                    // Flag: creating first build on EXISTING empty branch, not a new branch.
                    emptyBranchSqlId: branchSqlId,
                    emptyBranchExtId: branch.id,
                });
                closeDotMenu();
                return;
            }

            // Count same-type siblings off the same parent build (excluding self).
            const siblingOrd0 = (model.branches || [])
                .filter(b => b.parentBuildId === branch.parentBuildId
                    && b.type === branch.type
                    && b.id !== branch.id)
                .length;
            firstVersion = firstBuildOnNewBranchVersion({
                type: branch.type,
                parentBuild,
                siblingOrd0,
            });
        }

        // Build the POST chain: first build uses firstVersion, subsequent walk.
        const posts = [];
        let lastBuild = firstVersion;
        const branchMm = { major: firstVersion.major, minor: firstVersion.minor };
        for (let i = 0; i < n; i++) {
            const v = i === 0 ? firstVersion : nextBuildVersion({
                branchType: branch.type,
                lastBuild,
                branchMm,
            });
            posts.push(call_rest_api(
                `${darwinUri}/builds`, 'POST',
                {
                    branch_fk: branchSqlId,
                    position: i,
                    ...toBuildRow(v),
                    external_id: `${branch.id}-b${i + 1}`,
                },
                idToken,
            ));
            lastBuild = v;
        }
        try {
            await Promise.all(posts);
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Execute builds on empty branch failed:', err);
        }
        closeDotMenu();
    }, [dotMenu, dotMenuBranch, model, projectId, darwinUri, idToken, closeDotMenu,
        invalidateBuildData, openVersionPrompt]);

    // ─── Refactored create-branch helper (req #2742) ─────────────────────
    // Factored out so the sprint-branch-number prompt can call it with a
    // user-chosen firstBranchNumOverride. When present (n===1 sample path),
    // the first build's version is computed normally and then its branchNumber
    // is replaced with the override. Subsequent builds added later walk
    // lastBuild.branchNumber + 1 via nextBuildVersion — they continue cleanly.
    const doCreateBranch = useCallback(async ({
        type, n, buildExtId, parentBuildSqlId, parentBuild, baseOrd0, pid,
        firstBranchNumOverride,
    }) => {
        const label = REGISTRY[type]?.label || type;
        const stamp = Date.now();
        const mainSqlId = branchSqlIdRef.current.get('main');
        const doHandoff = takesMainMm(type) && mainSqlId;

        const chains = Array.from({ length: n }, (_, i) => (async () => {
            const base = firstBuildOnNewBranchVersion({ type, parentBuild, siblingOrd0: baseOrd0 + i });
            // When a firstBranchNumOverride is supplied (sprint off release),
            // replace the computed Branch# with the user's chosen value.
            const v = (firstBranchNumOverride != null && i === 0)
                ? { ...base, branchNumber: firstBranchNumOverride }
                : base;
            const slug = `${type}-${stamp}-${i}`;
            const branchRes = await call_rest_api(
                `${darwinUri}/branches`, 'POST',
                {
                    project_fk: pid,
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

        await Promise.all(chains);
        if (doHandoff) {
            const open = openMm();
            await call_rest_api(
                `${darwinUri}/branches`, 'PUT',
                [{ id: mainSqlId, major: open.major, minor: open.minor }],
                idToken,
            );
            openVersionPrompt(mainSqlId, 'Main');
        }
        invalidateBuildData();
    }, [darwinUri, idToken, invalidateBuildData, openVersionPrompt]);

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
        const parentBuild = fromModelBuild(model.builds?.[buildExtId]);
        const baseOrd0 = (model.branches || [])
            .filter(b => b.parentBuildId === buildExtId && b.type === type).length;

        // ─── Sprint-branch-number prompt gate (req #2742) ─────────────────
        // sample-release off a release parent: both share the same Branch#
        // range + the same frozen Build#. Prompt for a collision-free first
        // Branch# instead of creating with the default (which collides).
        if (needsBranchNumberPrompt({ childType: type, parentBranchType: parentType })) {
            const suggested = suggestFirstBranchNumber({ parentBuild, builds: model.builds });
            const used = usedBranchNumbersFor({ parentBuild, builds: model.builds });
            const parentBranchName = String(dotMenuBranch?.name || parentType).replace(/\n/g, ' / ');
            setSbnValue(String(suggested));
            setSampleBranchNumPrompt({
                type,
                parentBuildExtId: buildExtId,
                parentBuildSqlId,
                projectId,
                parentBranchName,
                frozen: {
                    major: parentBuild?.major ?? 0,
                    minor: parentBuild?.minor ?? 0,
                    build: parentBuild?.build ?? 0,
                },
                suggested,
                used,
                parentBuild,
                baseOrd0,
            });
            closeDotMenu();
            return;
        }

        try {
            await doCreateBranch({
                type, n, buildExtId, parentBuildSqlId, parentBuild, baseOrd0, pid: projectId,
            });
        } catch (err) {
            console.error('[BuildVisualizer] Create branch failed:', err);
        }
        closeDotMenu();
    }, [dotMenu, dotMenuBranch, projectId, model, darwinUri, idToken, closeDotMenu, invalidateBuildData, openVersionPrompt, doCreateBranch]);

    // Confirm handler for the sprint branch-number prompt. Supports two modes:
    //   1. Normal: creating a new branch + first build (doCreateBranch).
    //   2. Empty-branch: adding the first build to an existing empty branch
    //      (emptyBranchSqlId is set — POST /builds only, no branch creation).
    const confirmSampleBranchNum = useCallback(async () => {
        if (!sampleBranchNumPrompt || !sbnValid) return;
        const {
            type, parentBuildSqlId, projectId: pid,
            parentBuild, baseOrd0, parentBuildExtId,
            emptyBranchSqlId, emptyBranchExtId,
        } = sampleBranchNumPrompt;
        try {
            if (emptyBranchSqlId) {
                // Mode 2: first build on existing empty branch.
                const base = firstBuildOnNewBranchVersion({
                    type, parentBuild, siblingOrd0: baseOrd0,
                });
                const v = { ...base, branchNumber: sbnParsed };
                await call_rest_api(
                    `${darwinUri}/builds`, 'POST',
                    {
                        branch_fk: emptyBranchSqlId,
                        position: 0,
                        ...toBuildRow(v),
                        external_id: `${emptyBranchExtId}-b1`,
                    },
                    idToken,
                );
                invalidateBuildData();
            } else {
                // Mode 1: create new branch + first build.
                await doCreateBranch({
                    type,
                    n: 1,
                    buildExtId: parentBuildExtId,
                    parentBuildSqlId,
                    parentBuild,
                    baseOrd0,
                    pid,
                    firstBranchNumOverride: sbnParsed,
                });
            }
        } catch (err) {
            console.error('[BuildVisualizer] Create sprint branch failed:', err);
        }
        setSampleBranchNumPrompt(null);
    }, [sampleBranchNumPrompt, sbnValid, sbnParsed, doCreateBranch, darwinUri, idToken, invalidateBuildData]);

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

    // Declare / clear a day-zero merge requirement on the clicked build (req
    // #2603). Toggles the build's extId in the per-project localStorage set;
    // the canvas fans red arrows out to all release/hotfix/CSR branches.
    const handleToggleDayZero = useCallback(() => {
        if (!dotMenu?.buildRecord) return;
        toggleDayZero(dotMenu.buildRecord.id);
        closeDotMenu();
    }, [dotMenu, toggleDayZero, closeDotMenu]);

    // Toggle the clicked build's BRANCH merge view (req #2603). Closes the menu
    // so the arrows are visible against a clear canvas.
    const handleToggleBranchMerges = useCallback(() => {
        if (!dotMenuBranch) return;
        toggleMergeBranch(dotMenuBranch.id);
        closeDotMenu();
    }, [dotMenuBranch, toggleMergeBranch, closeDotMenu]);

    const handlePerformReleaseEvent = useCallback(() => {
        if (!dotMenu) return;
        setReleaseDialog({ buildId: dotMenu.buildRecord.id });
        setSelectedCustomerIds([]);
        closeDotMenu();
    }, [dotMenu, closeDotMenu]);

    // Delete build (req #2742). Gated by canDeleteBuild — last build on a
    // multi-build branch with no child branches parented off it. Opens the
    // delete confirmation dialog; the actual DELETE runs from confirmDelete.
    const handleDeleteBuild = useCallback(() => {
        if (!dotMenu || !dotMenuBranch) return;
        const buildExtId = dotMenu.buildRecord.id;
        const version = dotMenu.buildRecord.version || buildExtId;
        const row = buildSqlIdRef.current.get(buildExtId);
        const sqlId = row?.id || row;
        if (!sqlId) { closeDotMenu(); return; }
        const releaseEventCount = (model?.releaseEvents?.[buildExtId] || []).length;
        const branchName = String(dotMenuBranch.name || dotMenuBranch.id).replace(/\n/g, ' / ');
        setDeleteConfirm({
            kind: 'build',
            sqlId: Number(sqlId),
            version,
            branchName,
            releaseEventCount,
            approvedForRelease: !!dotMenu.buildRecord.approvedForRelease,
        });
        closeDotMenu();
    }, [dotMenu, dotMenuBranch, model, closeDotMenu]);

    // Delete branch (req #2742). Gated by canDeleteBranch — not main and no
    // child branches. FK cascade removes builds + customer_releases. Opens the
    // delete confirmation dialog; the actual DELETE runs from confirmDelete.
    const handleDeleteBranch = useCallback(() => {
        if (!branchEditor || !branchEditorBranch) return;
        const branchName = String(branchEditorBranch.name || branchEditor.branchId).replace(/\n/g, ' / ');
        const buildCount = branchEditorBranch.buildIds?.length || 0;
        const sqlId = branchSqlIdRef.current.get(branchEditor.branchId);
        if (!sqlId) { closeBranchEditor(); return; }
        // Sum release events across all builds on this branch.
        const releaseEventCount = (branchEditorBranch.buildIds || []).reduce(
            (sum, bid) => sum + (model?.releaseEvents?.[bid] || []).length,
            0,
        );
        const typeLabel = REGISTRY[branchEditorBranch.type]?.label || branchEditorBranch.type;
        setDeleteConfirm({
            kind: 'branch',
            sqlId: Number(sqlId),
            branchName,
            typeLabel,
            buildCount,
            releaseEventCount,
        });
        closeBranchEditor();
    }, [branchEditor, branchEditorBranch, model, closeBranchEditor]);

    // Confirm handler for the delete dialog — executes the actual DELETE,
    // invalidates the cache, then closes the dialog.
    const confirmDelete = useCallback(async () => {
        if (!deleteConfirm) return;
        const { kind, sqlId } = deleteConfirm;
        try {
            if (kind === 'build') {
                await call_rest_api(
                    `${darwinUri}/builds`, 'DELETE',
                    { id: sqlId },
                    idToken,
                );
            } else {
                await call_rest_api(
                    `${darwinUri}/branches`, 'DELETE',
                    { id: sqlId },
                    idToken,
                );
            }
            invalidateBuildData();
        } catch (err) {
            console.error(`[BuildVisualizer] Delete ${kind} failed:`, err);
        }
        setDeleteConfirm(null);
    }, [deleteConfirm, darwinUri, idToken, invalidateBuildData]);

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
                mergeBranchIds={mergeBranchSet}
                dayZeroBuildIds={dayZeroSet}
                appMode={effectiveMode}
                darkVariant={darkVariant}
                onBuildClick={handleBuildClick}
                onBuildLeave={scheduleCloseDotMenu}
                onBranchClick={handleBranchClick}
                onEmptyAnchorClick={handleEmptyAnchorClick}
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
                {isEmptyAnchorMenu ? (
                    /* ─── Empty-anchor mode — Execute Build only ─── */
                    <>
                        <Box sx={{ px: 2, pt: 1, pb: 0.5, pointerEvents: 'none' }}>
                            <Typography variant="subtitle2" fontWeight={700}>
                                {dotMenuBranch ? String(dotMenuBranch.name).replace(/\n/g, ' / ') : ''}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block">
                                No builds yet
                            </Typography>
                        </Box>
                        <Divider />
                        <HoldCountButton
                            label="Execute Build"
                            onExecute={executeBuildsOnEmptyBranch}
                            maxQty={MAX_BUILDS_PER_HOLD}
                            dwellMs={HOLD_DWELL_MS}
                            startDelayMs={HOLD_START_DELAY_MS}
                            data-testid="bv-menu-add-build"
                        />
                    </>
                ) : (
                    /* ─── Normal build-dot mode ─── */
                    <>
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
                                    const ts = dotMenu && model?.builds?.[dotMenu.buildRecord?.id]?.createdAt;
                                    return ts ? new Date(ts).toLocaleString() : '—';
                                })()}
                            </Typography>
                            {/* Branch location (req #2753) — informational, not a link.
                                Identifies the branch: project / branch name /
                                version of the branch's first build. */}
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                display="block"
                                sx={{ mt: 0.5, wordBreak: 'break-all' }}
                                data-testid="bv-build-location"
                            >
                                {formatBranchLocation(
                                    projectName,
                                    dotMenuBranch?.name,
                                    branchFirstBuildVersion(dotMenuBranch),
                                )}
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

                        {/* Readiness — two-state toggle (req #2737). Off = not ready
                            (default); On = ready. The label varies by branch type
                            (req #2772): Production / Sample / Debug / Hot Fix Ready. */}
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
                                label={readinessLabelFor(dotMenu?.buildRecord?.branchType)}
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

                        {/* Per-branch merge view (req #2603). Toggles this
                            build's branch in the merge-branch set so only the
                            chosen branches' arrows render — merges are reasoned
                            about one branch at a time, not all at once. Hidden
                            on main (no merge rules). */}
                        {dotMenuBranch && hasMergeRules(dotMenuBranch.type) && (
                            <>
                                <Divider />
                                <MenuItem
                                    onClick={handleToggleBranchMerges}
                                    data-testid="bv-menu-branch-merges"
                                >
                                    {mergeBranchSet.has(dotMenuBranch.id)
                                        ? 'Hide merges for this branch'
                                        : 'Show merges for this branch'}
                                </MenuItem>
                            </>
                        )}

                        {/* Day-zero merge requirement (req #2603). Declares the
                            build a zero-day source; the canvas fans red merge
                            arrows to every release/hotfix/CSR branch, shown
                            independently of any branch's merge view. */}
                        <Divider />
                        <MenuItem
                            onClick={handleToggleDayZero}
                            data-testid="bv-menu-dayzero"
                            sx={{ color: 'error.main' }}
                        >
                            {dotMenu?.buildRecord && dayZeroSet.has(dotMenu.buildRecord.id)
                                ? 'Clear day-zero merge'
                                : 'Declare day-zero merge…'}
                        </MenuItem>

                        {/* Delete build — destructive, at the bottom (req #2742).
                            Gated: last build, no child branch parented off it. */}
                        {dotMenu && dotMenuBranch && dotMenu.buildRecord && canDeleteBuild({
                            branch: dotMenuBranch,
                            buildId: dotMenu.buildRecord.id,
                            branches: model?.branches || [],
                        }) && (
                            <>
                                <Divider />
                                <MenuItem
                                    onClick={handleDeleteBuild}
                                    data-testid="bv-menu-delete-build"
                                    sx={{ color: 'error.main' }}
                                >
                                    Delete build…
                                </MenuItem>
                            </>
                        )}
                    </>
                )}
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
                            {/* Branch location (req #2753) — informational, not a link.
                                Same shape as the build menu: project / branch name /
                                version of the branch's first build (omitted when the
                                branch has no builds yet). */}
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                display="block"
                                sx={{ mt: 0.5, wordBreak: 'break-all' }}
                                data-testid="bv-branch-location"
                            >
                                {formatBranchLocation(
                                    projectName,
                                    branchEditorBranch.name,
                                    branchFirstBuildVersion(branchEditorBranch),
                                )}
                            </Typography>
                            {/* Per-branch merge view (req #2603) — show this
                                branch's required/evaluate merge arrows. Hidden on
                                main (no merge rules). */}
                            {hasMergeRules(branchEditorBranch.type) && (
                                <FormControlLabel
                                    sx={{ mt: 1, ml: 0 }}
                                    control={(
                                        <Switch
                                            size="small"
                                            checked={mergeBranchSet.has(branchEditorBranch.id)}
                                            onChange={() => toggleMergeBranch(branchEditorBranch.id)}
                                            inputProps={{ 'data-testid': 'bv-branch-merges-switch' }}
                                        />
                                    )}
                                    label="Show merge arrows"
                                />
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    {/* Delete — destructive, left-aligned (req #2742).
                        Gated: not main and no child branches. */}
                    {branchEditorBranch && canDeleteBranch({
                        branch: branchEditorBranch,
                        branches: model?.branches || [],
                    }) && (
                        <Button
                            color="error"
                            onClick={handleDeleteBranch}
                            sx={{ mr: 'auto' }}
                            data-testid="bv-branch-delete"
                        >
                            Delete
                        </Button>
                    )}
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

            {/* ─── Sprint branch-number prompt (req #2742) ─── */}
            <Dialog
                open={!!sampleBranchNumPrompt}
                onClose={() => setSampleBranchNumPrompt(null)}
                data-testid="bv-sample-branchnum-prompt"
            >
                <DialogTitle>Sprint branch number</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        A sprint branch off a release shares the release's
                        Major.Minor.Build coordinate, so it needs its own Branch#
                        to avoid version collisions.
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 0.5, fontFamily: 'monospace', fontWeight: 600 }}>
                        Version: {sampleBranchNumPrompt
                            ? `${sampleBranchNumPrompt.frozen.major}.${sampleBranchNumPrompt.frozen.minor}.${sampleBranchNumPrompt.frozen.build}.x`
                            : ''}
                    </Typography>
                    {sampleBranchNumPrompt?.used?.length > 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                            In use: {sampleBranchNumPrompt.used.join(', ')}
                        </Typography>
                    )}
                    <TextField
                        label="First Branch#"
                        type="number"
                        autoFocus
                        fullWidth
                        margin="dense"
                        value={sbnValue}
                        onChange={(e) => setSbnValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && sbnValid) confirmSampleBranchNum(); }}
                        inputProps={{
                            min: 1,
                            step: 1,
                            'data-testid': 'bv-sample-branchnum-input',
                        }}
                        error={sbnInUse}
                        helperText={sbnInUse
                            ? `Branch# ${sbnParsed} is already in use on this version`
                            : ''}
                    />
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setSampleBranchNumPrompt(null)}
                        data-testid="bv-sample-branchnum-cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={confirmSampleBranchNum}
                        disabled={!sbnValid}
                        variant="contained"
                        data-testid="bv-sample-branchnum-confirm"
                    >
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ─── Delete confirmation dialog (req #2742) ───
                 Mirrors TaskDeleteDialog: generic prompt + bordered preview
                 box rendering the item with contextual attributes. */}
            <Dialog
                open={!!deleteConfirm}
                onClose={() => setDeleteConfirm(null)}
                data-testid="bv-delete-dialog"
            >
                <DialogTitle>
                    {deleteConfirm?.kind === 'build' ? 'Delete Build' : 'Delete Branch'}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText data-testid="bv-delete-message">
                        {deleteConfirm?.kind === 'build'
                            ? 'Do you want to permanently delete this build?'
                            : 'Do you want to permanently delete this branch?'}
                    </DialogContentText>
                    {deleteConfirm && (
                        <Box
                            data-testid="bv-delete-preview"
                            sx={{
                                mt: 2,
                                mx: 2,
                                p: 1.5,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                bgcolor: 'background.paper',
                            }}
                        >
                            {deleteConfirm.kind === 'build' ? (
                                <>
                                    <Typography
                                        variant="body2"
                                        sx={{ fontFamily: 'monospace', fontWeight: 700 }}
                                    >
                                        {deleteConfirm.version}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {deleteConfirm.branchName}
                                    </Typography>
                                    {deleteConfirm.approvedForRelease && (
                                        <Typography variant="body2" color="text.secondary">
                                            Production ready
                                        </Typography>
                                    )}
                                    {deleteConfirm.releaseEventCount > 0 && (
                                        <Typography variant="body2" color="text.secondary">
                                            {`${deleteConfirm.releaseEventCount} customer release event${deleteConfirm.releaseEventCount === 1 ? '' : 's'}`}
                                        </Typography>
                                    )}
                                </>
                            ) : (
                                <>
                                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                        {deleteConfirm.branchName}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {deleteConfirm.typeLabel}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {`Deletes ${deleteConfirm.buildCount} build${deleteConfirm.buildCount === 1 ? '' : 's'}`}
                                        {deleteConfirm.releaseEventCount > 0
                                            ? ` and ${deleteConfirm.releaseEventCount} release event${deleteConfirm.releaseEventCount === 1 ? '' : 's'}`
                                            : ''}
                                    </Typography>
                                </>
                            )}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDeleteConfirm(null)}
                        data-testid="bv-delete-cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        autoFocus
                        onClick={confirmDelete}
                        data-testid="bv-delete-confirm-button"
                    >
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default BuildVisualizerPage;
