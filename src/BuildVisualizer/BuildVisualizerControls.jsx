import { useState } from 'react';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import BuildPatternMenu from './BuildPatternMenu';
import { BRANCH_TYPES, branchTypeChipProps, branchTypeLabel } from './branchTypeChipStyles';

// Dedicated horizontal control row above the build viewer (req #2616). One row
// only — replaces the prior two-row layout (outer React toolbar + inner iframe
// #toolbar bar) so the SVG can use the full remaining area without controls
// occluding it. Three groups in left-to-right order:
//   [ File menu ] | [ Release-type chips ] | [ Stagger toggle ]
const BuildVisualizerControls = ({
    lib,
    selectedTypes,
    onToggleType,
    staggerOn,
    onToggleStagger,
}) => {
    const [snack, setSnack] = useState(null);
    const showSnack = (severity, message) => setSnack({ severity, message });
    const closeSnack = () => setSnack(null);

    const staggerChipProps = staggerOn
        ? { sx: { bgcolor: '#1a1a1a', color: '#fff' } }
        : { variant: 'outlined' };

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
                    bgcolor: '#ffffff',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
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
