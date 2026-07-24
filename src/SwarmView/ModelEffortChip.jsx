// Presentational cell for a single Model or Effort value in a requirement row
// (req #3029; pill is the only rendering as of req #3043 — the compact/text
// modes were removed). Covers both axes (`kind`) so RequirementRow stays
// declarative.
//
// Carries a "Model: X" / "Effort: Y" tooltip so the value is never ambiguous.

import React from 'react';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { aiModelChipProps, aiModelLabel } from './modelChipStyles';
import { effortChipProps, effortLabel } from './effortChipStyles';

const ModelEffortChip = ({ kind, value, 'data-testid': testId }) => {
    const isModel = kind === 'model';
    const label = isModel ? aiModelLabel(value) : effortLabel(value);
    const chipProps = isModel ? aiModelChipProps(value) : effortChipProps(value);
    const tip = `${isModel ? 'Model' : 'Effort'}: ${label}`;

    return (
        <Tooltip title={tip} enterDelay={400} enterNextDelay={200}>
            <Chip label={label} size="small" data-testid={testId} {...chipProps} />
        </Tooltip>
    );
};

export default ModelEffortChip;
