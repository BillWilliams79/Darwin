import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import { useDndContext } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { ReorderList, useReorderItem, reorderRowSx } from '../dnd';

import call_rest_api from '../RestApi/RestApi';
import { mapViewKeys } from '../hooks/useQueryKeys';

const viewItemId = (view) => `map-view:${view.id}`;

// A lifted chip looks as it did before the foundation: itself, at 80%, with a light shadow.
const CHIP_LIFT_SX = { opacity: 0.8, boxShadow: 3, borderRadius: '16px' };

// Space lifts a focused chip and drops it again (the press timeline's keys); a
// chip is a button, and a button clicks on Space's keyup — which would open
// the view the drop just landed. Enter still clicks.
const noSpaceClick = (event) => { if (event.key === ' ') event.preventDefault(); };

// One chip of the bar's ReorderList (req #3664): the whole chip is the grip —
// a click selects (or edits) the view, a hold or a 4 px mouse move lifts it.
const ViewChip = ({ view, active, onClick }) => {
    const { ref, style, attributes, listeners, isDragging } = useReorderItem(viewItemId(view), view);
    const { active: dragging } = useDndContext();
    // A chip is a ButtonBase, which preventDefaults Space on keydown before any
    // onKeyDown of ours runs — and dnd-kit ignores a prevented event. The
    // keyboard activator listens in the capture phase so it sees Space first.
    const { onKeyDown, ...pointerListeners } = listeners ?? {};
    return (
        <Chip
            ref={ref}
            {...attributes}
            {...pointerListeners}
            onKeyDownCapture={onKeyDown}
            style={style}
            label={view.name}
            data-testid={`view-chip-${view.id}`}
            data-dragging={isDragging ? 'true' : undefined}
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            // Enter drops a keyboard drag on keydown, which a chip also reads as a click.
            onClick={() => { if (!dragging) onClick(view); }}
            onKeyUp={noSpaceClick}
            size="small"
            sx={(theme) => reorderRowSx(theme, { draggable: true, isDragging })}
        />
    );
};

const ViewBar = ({ views, activeViewId, onViewSelect, onCreateClick, onEditClick, darwinUri, idToken, creatorFk }) => {
    const queryClient = useQueryClient();

    const handleChipClick = (view) => {
        if (view.id === activeViewId) {
            // Clicking the already-active view opens edit
            onEditClick(view);
        } else {
            onViewSelect(view.id);
        }
    };

    const handleDragEnd = (fromIndex, toIndex) => {
        // Splice: reorder the views array
        const reordered = [...views];
        const [dragged] = reordered.splice(fromIndex, 1);
        reordered.splice(toIndex, 0, dragged);

        // Renumber sort_order
        const payload = reordered.map((v, index) => ({ id: v.id, sort_order: index }));

        // Optimistic update via query cache
        queryClient.setQueryData(mapViewKeys.all(creatorFk), reordered.map((v, index) => ({
            ...v,
            sort_order: index,
        })));

        // Persist to DB
        call_rest_api(`${darwinUri}/map_views`, 'PUT', payload, idToken)
            .then((res) => {
                if (res.httpStatus.httpStatus > 204) {
                    console.error('[ViewBar] reorder PUT failed:', res);
                    queryClient.invalidateQueries({ queryKey: mapViewKeys.all(creatorFk) });
                }
            })
            .catch((err) => {
                console.error('[ViewBar] reorder error:', err);
                queryClient.invalidateQueries({ queryKey: mapViewKeys.all(creatorFk) });
            });
    };

    const ids = useMemo(() => views.map(viewItemId), [views]);

    return (
        <Box
            data-testid="view-bar"
            sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                alignItems: 'center',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                px: 1,
                py: 0.5,
            }}
        >
            <Chip
                label="All"
                data-testid="view-chip-all"
                color={activeViewId === null ? 'primary' : 'default'}
                variant={activeViewId === null ? 'filled' : 'outlined'}
                onClick={() => onViewSelect(null)}
                size="small"
            />

            {/* req #3664 — chips of different widths that wrap: they reflow as the
                row does ('flow'); a hand drifting off the thin strip keeps sorting
                rather than dropping the move (Esc cancels). */}
            <ReorderList id="map-views" type="map-view" ids={ids}
                         orientation="flow" sortsOutside liftSx={CHIP_LIFT_SX}
                         onReorder={handleDragEnd}
                         data-testid="view-chip-list"
                         sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {views.map((view) => (
                    <ViewChip key={view.id} view={view} active={view.id === activeViewId}
                              onClick={handleChipClick} />
                ))}
            </ReorderList>

            <Chip
                icon={<AddIcon />}
                label="View"
                data-testid="view-chip-create"
                variant="outlined"
                onClick={onCreateClick}
                size="small"
            />
        </Box>
    );
};

export default ViewBar;
