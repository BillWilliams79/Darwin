import React, { useState, useCallback } from 'react';

import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

// req #4064 — the range is 0–9999, so the field is squeezed to four digits plus
// the go arrow, in a 72px box.
const REQ_JUMP_MAX_DIGITS = 4;
const REQ_JUMP_WIDTH = 72;

const fieldSx = {
    '& .MuiInputBase-root': { pr: 0.25 },
    '& .MuiInputBase-input': { py: 0.5, pl: 1, pr: 0.5, fontSize: 13 },
};

const RequirementJumpInput = () => {
    const [value, setValue] = useState('');

    const submit = useCallback(() => {
        const id = parseInt(value, 10);
        if (!Number.isFinite(id) || id <= 0) return;
        setValue('');
        // req #4185 — `?from=jump` tells the page it is a standalone tab: its exit is to
        // close itself and leave the reader on the page they jumped from.
        window.open(`/swarm/requirement/${id}?from=jump`, '_blank', 'noopener,noreferrer');
    }, [value]);

    const onKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
    };

    const onChange = (e) => {
        // digits only
        const v = e.target.value.replace(/\D/g, '').slice(0, REQ_JUMP_MAX_DIGITS);
        setValue(v);
    };

    return (
        <TextField
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder="Req"
            size="small"
            inputMode="numeric"
            data-testid="req-jump-input"
            sx={{ width: REQ_JUMP_WIDTH, ...fieldSx }}
            slotProps={{
                htmlInput: { maxLength: REQ_JUMP_MAX_DIGITS },
                input: {
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton
                                size="small"
                                onClick={submit}
                                aria-label="Go to requirement"
                                data-testid="req-jump-submit"
                                sx={{ p: 0.125 }}
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
