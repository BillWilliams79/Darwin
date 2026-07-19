import React from 'react';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';

import { filterChipProps } from './filterPalette';

/**
 * ChipFilter — the standardized multi-select filter selector for visualizer
 * views (req #2992).
 *
 * Contract (see memory/chip-filter-pattern.md for the full definition):
 *   - Multi-select. Every option toggles independently.
 *   - `selected === null` means "all options selected", INCLUDING options that
 *     do not exist yet. Dimensions backed by data (machines, projects) must use
 *     null as their default so newly-created rows are visible rather than
 *     silently filtered out.
 *   - An empty array is a legal selection meaning "show nothing". It is never
 *     auto-corrected back to all — a user who deselects everything gets an
 *     empty view, which is honest feedback that the filter is doing something.
 *   - Selected chips render filled in the option's color; unselected chips
 *     render outlined at 50% opacity. Color comes from the option's own
 *     chipProps when supplied, otherwise the standard palette.
 *
 * Selection state lives with the caller (a persisted Zustand store, per the
 * pattern doc). This component is presentational.
 *
 * @param options   [{ value, label, chipProps? }] — chipProps overrides palette color
 * @param selected  array of selected values, or null for "all"
 * @param onToggle  (value) => void
 * @param testId    data-testid for the container
 * @param chipTestIdPrefix  per-chip data-testid prefix (default 'filter-chip')
 */
const ChipFilter = ({
    options,
    selected,
    onToggle,
    testId,
    chipTestIdPrefix = 'filter-chip',
    size = 'small',
    spacing = 0.5,
    sx,
}) => (
    <Stack direction="row" spacing={spacing} flexWrap="wrap" useFlexGap data-testid={testId} sx={sx}>
        {options.map(({ value, label, chipProps }) => {
            const isSelected = selected === null || selected === undefined || selected.includes(value);
            const props = chipProps || filterChipProps(value);
            return (
                <Chip
                    key={String(value)}
                    label={label}
                    size={size}
                    onClick={() => onToggle(value)}
                    {...(isSelected ? props : { variant: 'outlined' })}
                    sx={{
                        ...(isSelected ? props.sx : {}),
                        ...(!isSelected && { opacity: 0.5 }),
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                    }}
                    data-testid={`${chipTestIdPrefix}-${value}`}
                />
            );
        })}
    </Stack>
);

export default ChipFilter;
