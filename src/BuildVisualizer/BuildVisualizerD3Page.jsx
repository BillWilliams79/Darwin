// req #2694 — Build Visualizer D3 — sister page to BuildVisualizerPage.
//
// State + toolbar wiring + Perform-Release-Event Dialog are copied from
// BuildVisualizerPage.jsx unchanged so every existing visualizer feature
// (chips, stagger, releases, style picker, theme picker, pattern menu,
// release-event Dialog) works without modification. The only structural
// change vs BuildVisualizerPage is in the body: the postMessage iframe is
// replaced by an in-React D3 canvas driven directly from the same state.

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import BuildVisualizerControls from './BuildVisualizerControls';
import BuildVisualizerD3Canvas from './BuildVisualizerD3Canvas';
import { useBuildPatterns } from './useBuildPatterns';
import { useBuildVisualizerD3Data } from './useBuildVisualizerD3Data';
import { BRANCH_TYPES } from './branchTypeChipStyles';
import {
    DEFAULT_DARK_VARIANT,
    isThemeVariant,
} from './themeVariants';
import ThemeContext from '../Theme/ThemeContext';
import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { fetchEntity } from '../hooks/factory/createEntityQueries';

// localStorage keys — same as BuildVisualizerPage so the two views share
// preferences (toggling Stagger in either view updates both).
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

const BuildVisualizerD3Page = () => {
    const lib = useBuildPatterns();
    const projectId = lib.activePattern?.projectId || null;
    const { isLoading: dataLoading, error: dataError, model } = useBuildVisualizerD3Data(projectId);

    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const queryClient = useQueryClient();

    // Customers — for the Perform-Release-Event Dialog (same source as BuildVisualizerPage).
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

    // Theme — same dark-variant flow as BuildVisualizerPage.
    const { effectiveMode } = useContext(ThemeContext);
    const [darkVariant, setDarkVariant] = useState(
        () => readStoredDarkVariant() || DEFAULT_DARK_VARIANT,
    );
    const changeDarkVariant = useCallback((variant) => {
        if (!isThemeVariant(variant)) return;
        setDarkVariant(variant);
        writeStoredDarkVariant(variant);
    }, []);

    // ─── Perform Release Event Dialog ────────────────────────────────────
    // Triggered by a future build-dot click flow (deferred for v1) — the Dialog
    // wiring is kept identical to BuildVisualizerPage so when that flow lands
    // the surface is already here. For now the Dialog is dormant.

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
            queryClient.invalidateQueries({ queryKey: ['bv-d3-customer-releases'] });
            queryClient.invalidateQueries({ queryKey: ['bv-d3-builds'] });
        } catch (err) {
            console.error('[BuildVisualizer-D3] Perform Release Event failed:', err);
        }
        setReleaseDialog(null);
        setSelectedCustomerIds([]);
    }, [releaseDialog, lib.activePattern, darwinUri, idToken, selectedCustomers, queryClient]);

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
            <BuildVisualizerD3Canvas
                model={model}
                isLoading={dataLoading || !lib.isReady}
                error={dataError || lib.error}
                selectedTypes={selectedTypes}
                staggerOn={staggerOn}
                showReleases={showReleases}
                releaseStyle={releaseStyle}
                appMode={effectiveMode}
                darkVariant={darkVariant}
            />
            <Dialog
                open={!!releaseDialog}
                onClose={cancelReleaseDialog}
                data-testid="bv-d3-release-event-dialog"
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
                                        data-testid={`bv-d3-release-customer-${c.id}`}
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
                        data-testid="bv-d3-release-event-confirm"
                    >
                        Release to selected
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default BuildVisualizerD3Page;
