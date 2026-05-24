import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import BuildPatternMenu from './BuildPatternMenu';
import { BRANCH_TYPES, branchTypeChipProps, branchTypeLabel } from './branchTypeChipStyles';

const BuildPatternToolbar = ({ lib, selectedTypes, onToggleType }) => {
    const [snack, setSnack] = useState(null);

    const showSnack = (severity, message) => setSnack({ severity, message });
    const closeSnack = () => setSnack(null);

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                flexWrap: 'wrap',
            }}
        >
            <BuildPatternMenu lib={lib} onShowSnack={showSnack} />

            <Box sx={{ flex: 1 }} />

            {selectedTypes && onToggleType && (
                <Stack
                    direction="row"
                    spacing={0.5}
                    flexWrap="wrap"
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
            )}

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
        </Box>
    );
};

export default BuildPatternToolbar;
