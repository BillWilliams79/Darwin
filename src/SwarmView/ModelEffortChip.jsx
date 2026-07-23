// Presentational cell for a single Model or Effort value in a requirement row
// (req #3029). One component covers both axes (`kind`) and all three display
// modes so RequirementRow stays declarative and the modes render identically
// wherever they appear.
//
//   pill    → full colored chip, e.g. "Opus" / "XHigh"  (reuses the table-view look)
//   text    → plain label, no background (theme-colored, low visual weight)
//   compact → single-letter colored chip, e.g. "O" / "X" — saves horizontal space;
//             the color still encodes the value and the tooltip names it in full
//
// Every mode carries a "Model: X" / "Effort: Y" tooltip so the abbreviated forms
// are never ambiguous.

import React from 'react';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { aiModelChipProps, aiModelLabel } from './modelChipStyles';
import { effortChipProps, effortLabel } from './effortChipStyles';

const ModelEffortChip = ({ kind, value, mode = 'pill', 'data-testid': testId }) => {
    const isModel = kind === 'model';
    const label = isModel ? aiModelLabel(value) : effortLabel(value);
    const chipProps = isModel ? aiModelChipProps(value) : effortChipProps(value);
    const tip = `${isModel ? 'Model' : 'Effort'}: ${label}`;

    if (mode === 'compact') {
        return (
            <Tooltip title={tip} enterDelay={400} enterNextDelay={200}>
                <Chip
                    label={label.charAt(0)}
                    size="small"
                    data-testid={testId}
                    {...chipProps}
                    sx={{
                        ...chipProps.sx,
                        width: 22,
                        height: 20,
                        fontWeight: 600,
                        '& .MuiChip-label': { px: 0 },
                    }}
                />
            </Tooltip>
        );
    }

    // pill (default) — semantic per-value color
    return (
        <Tooltip title={tip} enterDelay={400} enterNextDelay={200}>
            <Chip label={label} size="small" data-testid={testId} {...chipProps} />
        </Tooltip>
    );
};

export default ModelEffortChip;
