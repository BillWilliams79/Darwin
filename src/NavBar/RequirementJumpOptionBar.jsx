/* UI-OPTION: req #2409 — remove this file after variant is chosen */
import React from 'react';
import { useReqJumpVariantStore } from '../stores/useReqJumpVariantStore';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

const VARIANTS = [
    { value: 'A', label: 'A · Field + button',   tooltip: 'Variant A: small number field next to a "View Req" outlined button. Most explicit — two visually distinct elements.' },
    { value: 'B', label: 'B · Field + arrow',    tooltip: 'Variant B: number field with a trailing arrow icon-button inside the field. Most compact — one element with inline submit.' },
    { value: 'C', label: 'C · Field + # prefix', tooltip: 'Variant C: number field with a "#" prefix, Enter to submit, no visible button. Minimalist.' },
];

const RequirementJumpOptionBar = ({ compact = false }) => {
    const variant = useReqJumpVariantStore(s => s.variant);
    const setVariant = useReqJumpVariantStore(s => s.setVariant);

    return (
        <Box
            data-testid="req-jump-option-bar"
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                flexWrap: 'wrap',
                bgcolor: 'rgba(251,192,45,0.12)',
                border: '1px dashed rgba(251,192,45,0.55)',
                borderRadius: 0.5,
                px: compact ? 0.75 : 1,
                py: compact ? 0.5 : 0.75,
            }}
        >
            {!compact && (
                <Typography
                    sx={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#fbc02d',
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        mr: 0.5,
                    }}
                >
                    Req Jump variant
                </Typography>
            )}
            {VARIANTS.map(({ value, label, tooltip }) => {
                const selected = variant === value;
                return (
                    <Tooltip key={value} title={tooltip} placement="bottom">
                        <Chip
                            label={compact ? value : label}
                            size="small"
                            onClick={() => setVariant(value)}
                            data-testid={`req-jump-option-${value}`}
                            sx={selected
                                ? { bgcolor: '#fbc02d', color: '#000', cursor: 'pointer', fontSize: 11, height: 22 }
                                : { cursor: 'pointer', opacity: 0.75, color: 'rgba(0,0,0,0.75)', borderColor: 'rgba(251,192,45,0.55)', fontSize: 11, height: 22 }
                            }
                            variant={selected ? 'filled' : 'outlined'}
                        />
                    </Tooltip>
                );
            })}
        </Box>
    );
};

export default RequirementJumpOptionBar;
