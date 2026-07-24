// Presentational cell for a single Model or Effort value in a requirement row.
//
// req #3029 introduced these columns as pills; req #3043 made pill the only
// rendering; req #3046 replaced the pill with a small COLORED GLYPH ICON so
// Model and Effort read the same way as Status and Autonomy (small icon + hover
// tooltip), NOT a text chip. The glyph SHAPE distinguishes the two columns
// (robot = Model, bolt = Effort); the glyph COLOR encodes the level on the
// shared red→green ramp (req #3044); the tooltip names the exact value.
//
// Carries a "Model: X" / "Effort: Y" tooltip so the value is never ambiguous.

import React from 'react';
import Tooltip from '@mui/material/Tooltip';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import BoltIcon from '@mui/icons-material/Bolt';
import { aiModelIconColor, aiModelLabel } from './modelChipStyles';
import { effortIconColor, effortLabel } from './effortChipStyles';

const ModelEffortIcon = ({ kind, value, 'data-testid': testId }) => {
    const isModel = kind === 'model';
    const label = isModel ? aiModelLabel(value) : effortLabel(value);
    const color = isModel ? aiModelIconColor(value) : effortIconColor(value);
    const tip = `${isModel ? 'Model' : 'Effort'}: ${label}`;
    const Glyph = isModel ? SmartToyIcon : BoltIcon;

    return (
        <Tooltip title={tip} enterDelay={400} enterNextDelay={200}>
            <Glyph data-testid={testId} sx={{ fontSize: 18, color }} />
        </Tooltip>
    );
};

export default ModelEffortIcon;
