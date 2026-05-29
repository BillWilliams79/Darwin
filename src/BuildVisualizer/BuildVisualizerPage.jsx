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
import FormControlLabel from '@mui/material/FormControlLabel';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import BuildVisualizerControls from './BuildVisualizerControls';
import BuildVisualizerCanvas from './BuildVisualizerCanvas';
import { useBuildPatterns } from './useBuildPatterns';
import { useBuildVisualizerData } from './useBuildVisualizerData';
import { BRANCH_TYPES } from './branchTypeChipStyles';
import { REGISTRY } from './d3LayoutEngine';
import {
    DEFAULT_DARK_VARIANT,
    isThemeVariant,
} from './themeVariants';
import ThemeContext from '../Theme/ThemeContext';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';

// localStorage keys for user preferences.
const VERSION_LANES_STORAGE_KEY = 'darwin.buildVisualizer.versionLanes.v1';
const DARK_VARIANT_STORAGE_KEY = 'darwin.buildVisualizer.darkVariant.v1';
const SHOW_RELEASES_STORAGE_KEY = 'darwin.bv.showReleases';
const RELEASE_STYLE_STORAGE_KEY = 'darwin.bv.releaseStyle';

const readShowReleases = () => {
    try {
        return window.localStorage.getItem(SHOW_RELEASES_STORAGE_KEY) !== 'off';
    } catch (_) { return true; }
};
const writeShowReleases = (value) => {
    try { window.localStorage.setItem(SHOW_RELEASES_STORAGE_KEY, value ? 'on' : 'off'); } catch (_) {}
};
const readReleaseStyle = () => {
    try {
        const v = parseInt(window.localStorage.getItem(RELEASE_STYLE_STORAGE_KEY) || '', 10);
        return Number.isFinite(v) && v >= 1 && v <= 5 ? v : 1;
    } catch (_) { return 1; }
};
const writeReleaseStyle = (value) => {
    try { window.localStorage.setItem(RELEASE_STYLE_STORAGE_KEY, String(value)); } catch (_) {}
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

    // Release overlay.
    const [showReleases, setShowReleases] = useState(() => readShowReleases());
    const [releaseStyle, setReleaseStyle] = useState(() => readReleaseStyle());
    const toggleShowReleases = useCallback(() => setShowReleases(prev => !prev), []);
    const changeReleaseStyle = useCallback((v) => {
        const num = Number(v);
        if (!Number.isInteger(num) || num < 1 || num > 5) return;
        setReleaseStyle(num);
    }, []);
    useEffect(() => { writeShowReleases(showReleases); }, [showReleases]);
    useEffect(() => { writeReleaseStyle(releaseStyle); }, [releaseStyle]);

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

    // ─── Build-dot context menu (req #2720) ────────────────────────────
    // Mirrors the iframe's _showMenu: Run another build, Create branch submenu,
    // Mark/Unmark production ready, Perform release event.
    const [dotMenu, setDotMenu] = useState(null); // { buildRecord, anchorEl }
    const [branchSubmenuAnchor, setBranchSubmenuAnchor] = useState(null);

    // The anchorEl for the Menu needs to be a real DOM element. Since the click
    // comes from an SVG element (which MUI Menu can't anchor to reliably), we
    // use anchorPosition instead, derived from the mouse event coordinates.
    const dotMenuPosition = dotMenu
        ? { top: dotMenu.mouseY, left: dotMenu.mouseX }
        : undefined;

    const handleBuildClick = useCallback((buildRecord, e) => {
        // `e` is the React SyntheticEvent from the SVG click. Use its
        // clientX/clientY for menu positioning.
        setDotMenu({
            buildRecord,
            mouseX: e.clientX,
            mouseY: e.clientY,
        });
        setBranchSubmenuAnchor(null);
    }, []);

    const closeDotMenu = useCallback(() => {
        setDotMenu(null);
        setBranchSubmenuAnchor(null);
    }, []);

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

    const handleAddBuild = useCallback(async () => {
        if (!dotMenu || !dotMenuBranch) { closeDotMenu(); return; }
        const branchSqlId = branchSqlIdRef.current.get(dotMenuBranch.id);
        if (!branchSqlId) { closeDotMenu(); return; }
        // Determine position = max existing position + 1.
        const existingPositions = (dotMenuBranch.buildIds || []).map(bid => {
            const b = model.builds[bid];
            return b ? b.position : -1;
        });
        const nextPosition = existingPositions.length > 0
            ? Math.max(...existingPositions) + 1
            : 0;
        // Derive build_number and branch_number from the branch's existing pattern.
        // For simplicity, use the last build's values as reference.
        const lastBuildId = dotMenuBranch.buildIds?.[dotMenuBranch.buildIds.length - 1];
        const lastBuild = lastBuildId ? model.builds[lastBuildId] : null;
        const buildNumber = lastBuild ? lastBuild.build : 1;
        const branchNumber = lastBuild ? lastBuild.branchNum + 1 : 0;
        const major = lastBuild ? lastBuild.major : (dotMenuBranch.major || 1);
        const minor = lastBuild ? lastBuild.minor : (dotMenuBranch.minor || 0);
        // Generate external_id slug.
        const slug = `${dotMenuBranch.id}-b${nextPosition + 1}`;
        try {
            await call_rest_api(
                `${darwinUri}/builds`, 'POST',
                {
                    branch_fk: branchSqlId,
                    position: nextPosition,
                    build_number: buildNumber,
                    branch_number: branchNumber,
                    major,
                    minor,
                    external_id: slug,
                },
                idToken,
            );
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Add build failed:', err);
        }
        closeDotMenu();
    }, [dotMenu, dotMenuBranch, model, darwinUri, idToken, closeDotMenu, invalidateBuildData]);

    const handleCreateBranch = useCallback(async (type) => {
        if (!dotMenu || !projectId) { closeDotMenu(); return; }
        const buildExtId = dotMenu.buildRecord.id;
        const buildSqlRow = buildSqlIdRef.current.get(buildExtId);
        if (!buildSqlRow) { closeDotMenu(); return; }
        const parentBuildSqlId = buildSqlRow.id || buildSqlRow;
        const label = REGISTRY[type]?.label || type;
        // Generate a slug for the new branch.
        const slug = `${type}-${Date.now()}`;
        const major = dotMenu.buildRecord.approvedForRelease
            ? (Number(buildSqlRow.major) || 1)
            : (Number(buildSqlRow.major) || 1);
        const minor = Number(buildSqlRow.minor) || 0;
        try {
            const branchRes = await call_rest_api(
                `${darwinUri}/branches`, 'POST',
                {
                    project_fk: projectId,
                    branch_type: type,
                    name: label,
                    major,
                    minor,
                    parent_build_fk: Number(parentBuildSqlId),
                    external_id: slug,
                    side: REGISTRY[type]?.defaultSide || 'above',
                },
                idToken,
            );
            const branch = branchRes?.data;
            const newBranchId = Array.isArray(branch) ? branch[0]?.id : branch?.id;
            if (newBranchId) {
                // Add the first build on the new branch.
                const buildNum = Number(buildSqlRow.build_number) || 1;
                await call_rest_api(
                    `${darwinUri}/builds`, 'POST',
                    {
                        branch_fk: newBranchId,
                        position: 0,
                        build_number: buildNum,
                        branch_number: 1,
                        major,
                        minor,
                        external_id: `${slug}-b1`,
                    },
                    idToken,
                );
            }
            invalidateBuildData();
        } catch (err) {
            console.error('[BuildVisualizer] Create branch failed:', err);
        }
        closeDotMenu();
    }, [dotMenu, projectId, darwinUri, idToken, closeDotMenu, invalidateBuildData]);

    const handleToggleApproved = useCallback(async () => {
        if (!dotMenu) { closeDotMenu(); return; }
        const buildExtId = dotMenu.buildRecord.id;
        const buildSqlRow = buildSqlIdRef.current.get(buildExtId);
        if (!buildSqlRow) { closeDotMenu(); return; }
        const sqlId = buildSqlRow.id || buildSqlRow;
        const newVal = !dotMenu.buildRecord.approvedForRelease;
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
        closeDotMenu();
    }, [dotMenu, darwinUri, idToken, closeDotMenu, invalidateBuildData]);

    const handlePerformReleaseEvent = useCallback(() => {
        if (!dotMenu) return;
        setReleaseDialog({ buildId: dotMenu.buildRecord.id });
        setSelectedCustomerIds([]);
        closeDotMenu();
    }, [dotMenu, closeDotMenu]);

    // Branch types available for the "Create branch" submenu.
    const branchSubtypes = useMemo(
        () => Object.keys(REGISTRY).filter(t => t !== 'main'),
        [],
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
                appMode={effectiveMode}
                darkVariant={darkVariant}
                onChangeDarkVariant={changeDarkVariant}
                showReleases={showReleases}
                onToggleShowReleases={toggleShowReleases}
                releaseStyle={releaseStyle}
                onChangeReleaseStyle={changeReleaseStyle}
            />
            <BuildVisualizerCanvas
                model={model}
                isLoading={dataLoading || !lib.isReady}
                error={dataError || lib.error}
                selectedTypes={selectedTypes}
                staggerOn={staggerOn}
                showReleases={showReleases}
                releaseStyle={releaseStyle}
                appMode={effectiveMode}
                darkVariant={darkVariant}
                onBuildClick={handleBuildClick}
            />

            {/* ─── Build-dot context menu (req #2720) ─────────────────── */}
            <Menu
                open={!!dotMenu}
                onClose={closeDotMenu}
                anchorReference="anchorPosition"
                anchorPosition={dotMenuPosition}
                data-testid="bv-build-menu"
            >
                {/* Header: Build # + version + branch name */}
                <Box sx={{ px: 2, pt: 1, pb: 0.5, pointerEvents: 'none' }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                        Build #{dotMenu?.buildRecord?.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                        v{dotMenu?.buildRecord?.version}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                        on {dotMenuBranch ? String(dotMenuBranch.name).replace(/\n/g, ' / ') : ''}
                    </Typography>
                </Box>
                <Divider />
                <MenuItem
                    onClick={handleAddBuild}
                    data-testid="bv-menu-add-build"
                >
                    Run another build on this branch
                </MenuItem>
                <MenuItem
                    onClick={(e) => setBranchSubmenuAnchor(e.currentTarget)}
                    data-testid="bv-menu-create-branch"
                >
                    Create branch from this build
                </MenuItem>
                <MenuItem
                    onClick={handleToggleApproved}
                    data-testid="bv-menu-approve"
                >
                    {dotMenu?.buildRecord?.approvedForRelease
                        ? 'Unmark as production ready'
                        : 'Mark as production ready'}
                </MenuItem>
                {dotMenu?.buildRecord?.approvedForRelease && (
                    <MenuItem
                        onClick={handlePerformReleaseEvent}
                        data-testid="bv-menu-release-prompt"
                    >
                        Perform release event...
                    </MenuItem>
                )}
            </Menu>

            {/* Branch-type submenu */}
            <Menu
                open={!!branchSubmenuAnchor}
                onClose={() => setBranchSubmenuAnchor(null)}
                anchorEl={branchSubmenuAnchor}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                data-testid="bv-branch-submenu"
            >
                {branchSubtypes.map(t => (
                    <MenuItem
                        key={t}
                        onClick={() => handleCreateBranch(t)}
                        data-testid={`bv-menu-branch-${t}`}
                    >
                        {REGISTRY[t].label}
                    </MenuItem>
                ))}
            </Menu>

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
