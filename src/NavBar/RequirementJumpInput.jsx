import React, { useState, useCallback } from 'react';

import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

const fieldSx = {
    '& .MuiInputBase-input': { py: 0.5, fontSize: 13 },
};

const RequirementJumpInput = () => {
    const [value, setValue] = useState('');

    const submit = useCallback(() => {
        const id = parseInt(value, 10);
        if (!Number.isFinite(id) || id <= 0) return;
        setValue('');
        window.open(`/swarm/requirement/${id}`, '_blank', 'noopener,noreferrer');
    }, [value]);

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

    return (
        <TextField
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder="Req #"
            size="small"
            inputMode="numeric"
            data-testid="req-jump-input"
            sx={{ width: 110, ...fieldSx }}
            slotProps={{
                input: {
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton
                                size="small"
                                onClick={submit}
                                data-testid="req-jump-submit"
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
};

export default RequirementJumpInput;
