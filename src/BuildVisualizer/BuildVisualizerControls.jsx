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
const RELEASE_STYLE_LABELS = {
    1: 'Gold Star',
    2: 'Halo',
    3: 'Pennant',
    4: 'Sunburst',
    5: 'Chip Row',
};

const BuildVisualizerControls = ({
    lib,
    selectedTypes,
    onToggleType,
    staggerOn,
    onToggleStagger,
    appMode,
    darkVariant,
    onChangeDarkVariant,
    showReleases,
    onToggleShowReleases,
    releaseStyle,
    onChangeReleaseStyle,
}) => {
    const [snack, setSnack] = useState(null);
    const [themeAnchor, setThemeAnchor] = useState(null);
    const [releaseStyleAnchor, setReleaseStyleAnchor] = useState(null);
    const showSnack = (severity, message) => setSnack({ severity, message });
    const closeSnack = () => setSnack(null);

    const staggerChipProps = staggerOn
        ? { sx: { bgcolor: 'text.primary', color: 'background.paper' } }
        : { variant: 'outlined' };

    const releasesChipProps = showReleases
        ? { sx: { bgcolor: 'warning.main', color: 'background.paper' } }
        : { variant: 'outlined' };

    const showThemePicker = appMode === 'dark' && Boolean(onChangeDarkVariant);
    const openThemeMenu = (e) => setThemeAnchor(e.currentTarget);
    const closeThemeMenu = () => setThemeAnchor(null);
    const selectVariant = (variant) => {
        closeThemeMenu();
        if (variant !== darkVariant) onChangeDarkVariant?.(variant);
    };

    const showReleaseControls =
        Boolean(onToggleShowReleases) && Boolean(onChangeReleaseStyle);
    const openReleaseStyleMenu = (e) => setReleaseStyleAnchor(e.currentTarget);
    const closeReleaseStyleMenu = () => setReleaseStyleAnchor(null);
    const selectReleaseStyle = (v) => {
        closeReleaseStyleMenu();
        if (v !== releaseStyle) onChangeReleaseStyle?.(v);
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

                {showReleaseControls && (
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
                        <Chip
                            label={`Style: ${RELEASE_STYLE_LABELS[releaseStyle] || 'Gold Star'}`}
                            size="small"
                            onClick={openReleaseStyleMenu}
                            variant="outlined"
                            disabled={!showReleases}
                            sx={{ cursor: showReleases ? 'pointer' : 'not-allowed' }}
                            aria-haspopup="true"
                            aria-expanded={Boolean(releaseStyleAnchor) ? 'true' : undefined}
                            data-testid="bv-release-style-chip"
                        />
                        <Menu
                            anchorEl={releaseStyleAnchor}
                            open={Boolean(releaseStyleAnchor)}
                            onClose={closeReleaseStyleMenu}
                            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            slotProps={{ paper: { sx: { minWidth: 180 } } }}
                        >
                            {[1, 2, 3, 4, 5].map(v => (
                                <MenuItem
                                    key={v}
                                    selected={v === releaseStyle}
                                    onClick={() => selectReleaseStyle(v)}
                                    data-testid={`bv-release-style-option-${v}`}
                                >
                                    <ListItemIcon>
                                        {v === releaseStyle ? <CheckIcon fontSize="small" /> : <Box sx={{ width: 20 }} />}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={`${v}. ${RELEASE_STYLE_LABELS[v]}`}
                                        primaryTypographyProps={{
                                            sx: v === releaseStyle ? { fontWeight: 600 } : undefined,
                                        }}
                                    />
                                </MenuItem>
                            ))}
                        </Menu>
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
