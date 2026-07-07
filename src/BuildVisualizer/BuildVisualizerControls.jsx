import { useState } from 'react';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import CheckIcon from '@mui/icons-material/Check';
import BuildPatternMenu from './BuildPatternMenu';
import MergeRulesDialog from './MergeRulesDialog';
import { BRANCH_TYPES, branchTypeChipProps, branchTypeLabel } from './branchTypeChipStyles';
import {
    THEME_VARIANTS,
    themeVariantLabel,
    themeVariantTagline,
    themeVariantSwatch,
    themeVariantAccent,
    themeVariantBorder,
} from './themeVariants';

// Dedicated horizontal control row above the build viewer (req #2616). One row
// only — a single horizontal control row above the build visualizer canvas.
// Four groups in left-to-right order:
//   [ File menu ] | [ Release-type chips ] | [ Stagger toggle ] | [ Theme menu ]
//
// The Theme menu is **dark-mode-only** (req #2621 follow-up). When Darwin's app
// theme is light the visualizer always renders light and the picker is hidden
// — there's only one sensible color scheme to offer in that case. Dark mode
// exposes the six dark variants.
const BuildVisualizerControls = ({
    lib,
    selectedTypes,
    onToggleType,
    staggerOn,
    onToggleStagger,
    onResetView,
    appMode,
    darkVariant,
    onChangeDarkVariant,
    showReleases,
    onToggleShowReleases,
    pinnedLevel,
    effectiveLevel,
    onChangePinnedLevel,
    collapseEnabled,
    onToggleCollapseEnabled,
    showAcceptanceTests,
    onToggleShowAcceptanceTests,
    showBuildAt,
    onToggleShowBuildAt,
}) => {
    const [snack, setSnack] = useState(null);
    const [themeAnchor, setThemeAnchor] = useState(null);
    const [mergeRulesOpen, setMergeRulesOpen] = useState(false);
    const showSnack = (severity, message) => setSnack({ severity, message });
    const closeSnack = () => setSnack(null);

    const staggerChipProps = staggerOn
        ? { sx: { bgcolor: 'text.primary', color: 'background.paper' } }
        : { variant: 'outlined' };

    const releasesChipProps = showReleases
        ? { sx: { bgcolor: 'warning.main', color: 'background.paper' } }
        : { variant: 'outlined' };

    const atsChipProps = showAcceptanceTests
        ? { sx: { bgcolor: 'success.main', color: 'background.paper' } }
        : { variant: 'outlined' };

    // Build AT is a SUB-toggle of the master Acceptance Tests switch — only
    // meaningful when ATs are shown (req #2633 review round). Grayed/inert
    // otherwise.
    const buildAtDisabled = showAcceptanceTests === false;
    const buildAtChipProps = (showBuildAt && !buildAtDisabled)
        ? { sx: { bgcolor: 'success.main', color: 'background.paper' } }
        : { variant: 'outlined' };

    const showThemePicker = appMode === 'dark' && Boolean(onChangeDarkVariant);
    const openThemeMenu = (e) => setThemeAnchor(e.currentTarget);
    const closeThemeMenu = () => setThemeAnchor(null);
    const selectVariant = (variant) => {
        closeThemeMenu();
        if (variant !== darkVariant) onChangeDarkVariant?.(variant);
    };

    return (
        <>
            <Paper
                elevation={0}
                square
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 2,
                    py: 1,
                    bgcolor: 'background.paper',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
                }}
                data-testid="build-visualizer-controls"
            >
                <BuildPatternMenu lib={lib} onShowSnack={showSnack} />

                {selectedTypes && onToggleType && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                        <Stack
                            direction="row"
                            spacing={0.5}
                            useFlexGap
                            data-testid="branch-type-filter"
                        >
                            {BRANCH_TYPES.map(type => {
                                const selected = selectedTypes.includes(type);
                                const chipProps = branchTypeChipProps(type);
                                return (
                                    <Chip
                                        key={type}
                                        label={branchTypeLabel(type)}
                                        size="small"
                                        onClick={() => onToggleType(type)}
                                        {...(selected ? chipProps : { variant: 'outlined' })}
                                        sx={{
                                            ...(selected ? chipProps.sx : {}),
                                            ...(!selected && { opacity: 0.5 }),
                                            cursor: 'pointer',
                                        }}
                                        data-testid={`branch-type-chip-${type}`}
                                    />
                                );
                            })}
                        </Stack>
                    </>
                )}

                {onResetView && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                        <Chip
                            label="Reset view"
                            size="small"
                            onClick={onResetView}
                            variant="outlined"
                            sx={{ cursor: 'pointer' }}
                            data-testid="bv-reset-view"
                        />
                    </>
                )}

                {/* Merge Rules reference popup (req #2877) — always available,
                    self-contained dialog state. */}
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <Chip
                    label="Merge Rules"
                    size="small"
                    onClick={() => setMergeRulesOpen(true)}
                    variant="outlined"
                    sx={{ cursor: 'pointer' }}
                    aria-haspopup="dialog"
                    data-testid="bv-merge-rules-chip"
                />

                {onToggleShowReleases && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                        <Chip
                            label="Releases"
                            size="small"
                            onClick={onToggleShowReleases}
                            {...releasesChipProps}
                            sx={{
                                ...(showReleases ? releasesChipProps.sx : {}),
                                cursor: 'pointer',
                            }}
                            aria-pressed={showReleases ? 'true' : 'false'}
                            data-testid="bv-releases-toggle"
                        />
                    </>
                )}

                {onChangePinnedLevel && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                        <Stack direction="row" spacing={0.5} useFlexGap alignItems="center"
                               data-testid="bv-level-control">
                            <Box component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary', mr: 0.25 }}>
                                Detail:
                            </Box>
                            <Chip
                                label="Auto"
                                size="small"
                                onClick={() => onChangePinnedLevel(null)}
                                {...(pinnedLevel == null
                                    ? { sx: { bgcolor: 'primary.main', color: 'primary.contrastText', cursor: 'pointer' } }
                                    : { variant: 'outlined', sx: { cursor: 'pointer' } })}
                                aria-pressed={pinnedLevel == null ? 'true' : 'false'}
                                data-testid="bv-level-auto"
                            />
                            {[1, 2, 3].map(lvl => {
                                const pinned = pinnedLevel === lvl;
                                // When on Auto, softly mark the level the zoom is currently at.
                                const isAutoActive = pinnedLevel == null && effectiveLevel === lvl;
                                return (
                                    <Chip
                                        key={lvl}
                                        label={`L${lvl}`}
                                        size="small"
                                        onClick={() => onChangePinnedLevel(pinned ? null : lvl)}
                                        {...(pinned
                                            ? { sx: { bgcolor: 'text.primary', color: 'background.paper', cursor: 'pointer' } }
                                            : {
                                                variant: 'outlined',
                                                sx: {
                                                    cursor: 'pointer',
                                                    ...(isAutoActive && {
                                                        borderColor: 'primary.main',
                                                        color: 'primary.main',
                                                        fontWeight: 600,
                                                    }),
                                                },
                                            })}
                                        aria-pressed={pinned ? 'true' : 'false'}
                                        data-testid={`bv-level-${lvl}`}
                                    />
                                );
                            })}
                            {/* Collapse on/off (req #2892) — plays with the L2/L3
                                collapse rules. Inert at L1 ("L1 is its own thing"),
                                which always collapses regardless. */}
                            {onToggleCollapseEnabled && (() => {
                                const collapseInert = effectiveLevel === 1;
                                return (
                                    <Chip
                                        label={`Collapse: ${collapseEnabled ? 'On' : 'Off'}`}
                                        size="small"
                                        onClick={collapseInert ? undefined : onToggleCollapseEnabled}
                                        disabled={collapseInert}
                                        {...(collapseEnabled && !collapseInert
                                            ? { sx: { bgcolor: 'text.primary', color: 'background.paper', cursor: 'pointer' } }
                                            : { variant: 'outlined', sx: {
                                                cursor: collapseInert ? 'not-allowed' : 'pointer',
                                                ...(collapseInert && { opacity: 0.4 }),
                                            } })}
                                        aria-pressed={collapseEnabled ? 'true' : 'false'}
                                        aria-disabled={collapseInert ? 'true' : 'false'}
                                        data-testid="bv-collapse-toggle"
                                    />
                                );
                            })()}
                        </Stack>
                    </>
                )}

                {onToggleShowAcceptanceTests && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                        <Chip
                            label="Acceptance Tests"
                            size="small"
                            onClick={onToggleShowAcceptanceTests}
                            {...atsChipProps}
                            sx={{
                                ...(showAcceptanceTests ? atsChipProps.sx : {}),
                                cursor: 'pointer',
                            }}
                            aria-pressed={showAcceptanceTests ? 'true' : 'false'}
                            data-testid="bv-ats-toggle"
                        />
                    </>
                )}

                {onToggleShowBuildAt && (
                    <>
                        <Chip
                            label="Build AT"
                            size="small"
                            onClick={buildAtDisabled ? undefined : onToggleShowBuildAt}
                            disabled={buildAtDisabled}
                            {...buildAtChipProps}
                            sx={{
                                ...((showBuildAt && !buildAtDisabled) ? buildAtChipProps.sx : {}),
                                cursor: buildAtDisabled ? 'not-allowed' : 'pointer',
                                ...(buildAtDisabled && { opacity: 0.4 }),
                            }}
                            aria-pressed={showBuildAt ? 'true' : 'false'}
                            aria-disabled={buildAtDisabled ? 'true' : 'false'}
                            data-testid="bv-build-at-toggle"
                        />
                    </>
                )}

                {onToggleStagger && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                        <Chip
                            label="Stagger"
                            size="small"
                            onClick={onToggleStagger}
                            {...staggerChipProps}
                            sx={{
                                ...(staggerOn ? staggerChipProps.sx : {}),
                                cursor: 'pointer',
                            }}
                            aria-pressed={staggerOn ? 'true' : 'false'}
                            data-testid="bv-stagger-toggle"
                        />
                    </>
                )}

                {showThemePicker && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                        <Chip
                            label={`Theme: ${themeVariantLabel(darkVariant)}`}
                            size="small"
                            onClick={openThemeMenu}
                            variant="outlined"
                            icon={
                                <Box
                                    sx={{
                                        width: 14,
                                        height: 14,
                                        ml: '6px',
                                        borderRadius: '50%',
                                        bgcolor: themeVariantSwatch(darkVariant),
                                        border: '1px solid',
                                        borderColor: themeVariantBorder(darkVariant),
                                        boxShadow: 'inset 0 0 0 2px',
                                        color: themeVariantAccent(darkVariant),
                                    }}
                                />
                            }
                            sx={{ cursor: 'pointer' }}
                            aria-haspopup="true"
                            aria-expanded={Boolean(themeAnchor) ? 'true' : undefined}
                            data-testid="bv-theme-chip"
                        />
                        <Menu
                            anchorEl={themeAnchor}
                            open={Boolean(themeAnchor)}
                            onClose={closeThemeMenu}
                            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            slotProps={{ paper: { sx: { minWidth: 260 } } }}
                        >
                            {THEME_VARIANTS.map(v => {
                                const active = v === darkVariant;
                                return (
                                    <MenuItem
                                        key={v}
                                        selected={active}
                                        onClick={() => selectVariant(v)}
                                        data-testid={`bv-theme-option-${v}`}
                                    >
                                        <ListItemIcon>
                                            {active ? (
                                                <CheckIcon fontSize="small" />
                                            ) : (
                                                <Box
                                                    sx={{
                                                        width: 18,
                                                        height: 18,
                                                        borderRadius: '50%',
                                                        bgcolor: themeVariantSwatch(v),
                                                        border: '1px solid',
                                                        borderColor: themeVariantBorder(v),
                                                        boxShadow: 'inset 0 0 0 3px',
                                                        color: themeVariantAccent(v),
                                                    }}
                                                />
                                            )}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={themeVariantLabel(v)}
                                            secondary={themeVariantTagline(v)}
                                            primaryTypographyProps={{
                                                sx: active ? { fontWeight: 600 } : undefined,
                                            }}
                                            secondaryTypographyProps={{
                                                sx: { fontSize: '0.72rem' },
                                            }}
                                        />
                                    </MenuItem>
                                );
                            })}
                        </Menu>
                    </>
                )}
            </Paper>

            <MergeRulesDialog
                open={mergeRulesOpen}
                onClose={() => setMergeRulesOpen(false)}
            />

            <Snackbar
                open={!!snack}
                autoHideDuration={1800}
                onClose={closeSnack}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                {snack ? (
                    <Alert severity={snack.severity} onClose={closeSnack} variant="filled">
                        {snack.message}
                    </Alert>
                ) : undefined}
            </Snackbar>
        </>
    );
};

export default BuildVisualizerControls;
