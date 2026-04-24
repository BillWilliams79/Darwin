import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

const fieldSx = {
    '& .MuiInputBase-input': { py: 0.5, fontSize: 13 },
};

const RequirementJumpInput = ({ variant = 'A' }) => {
    const navigate = useNavigate();
    const [value, setValue] = useState('');

    const submit = useCallback(() => {
        const id = parseInt(value, 10);
        if (!Number.isFinite(id) || id <= 0) return;
        setValue('');
        navigate(`/swarm/requirement/${id}`);
    }, [value, navigate]);

    const onKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
    };

    const onChange = (e) => {
        // digits only
        const v = e.target.value.replace(/\D/g, '');
        setValue(v);
    };

    if (variant === 'B') {
        return (
            <TextField
                value={value}
                onChange={onChange}
                onKeyDown={onKeyDown}
                placeholder="Req #"
                size="small"
                inputMode="numeric"
                data-testid="req-jump-input-B"
                sx={{ width: 110, ...fieldSx }}
                slotProps={{
                    input: {
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    size="small"
                                    onClick={submit}
                                    data-testid="req-jump-submit-B"
                                    sx={{ p: 0.25 }}
                                >
                                    <ArrowForwardIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </InputAdornment>
                        ),
                    },
                }}
            />
        );
    }

    if (variant === 'C') {
        return (
            <TextField
                value={value}
                onChange={onChange}
                onKeyDown={onKeyDown}
                placeholder="req"
                size="small"
                inputMode="numeric"
                data-testid="req-jump-input-C"
                sx={{ width: 90, ...fieldSx }}
                slotProps={{
                    input: {
                        startAdornment: (
                            <InputAdornment position="start" sx={{ mr: 0.5 }}>
                                #
                            </InputAdornment>
                        ),
                    },
                }}
            />
        );
    }

    // variant === 'A' (default)
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField
                value={value}
                onChange={onChange}
                onKeyDown={onKeyDown}
                placeholder="#"
                size="small"
                inputMode="numeric"
                data-testid="req-jump-input-A"
                sx={{ width: 60, ...fieldSx }}
            />
            <Button
                size="small"
                variant="outlined"
                onClick={submit}
                data-testid="req-jump-submit-A"
                sx={{
                    minWidth: 0,
                    px: 1,
                    py: 0.25,
                    fontSize: 12,
                    lineHeight: 1.2,
                    textTransform: 'none',
                    whiteSpace: 'nowrap',
                }}
            >
                View Req
            </Button>
        </Box>
    );
};

export default RequirementJumpInput;
