import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useQueryClient } from '@tanstack/react-query';

import call_rest_api from '../RestApi/RestApi';
import { mapViewKeys } from '../hooks/useQueryKeys';

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

    const handleDragEnd = (result) => {
        if (!result.destination || result.reason !== 'DROP') return;
        if (result.source.index === result.destination.index) return;

        // Splice: reorder the views array
        const reordered = [...views];
        const [dragged] = reordered.splice(result.source.index, 1);
        reordered.splice(result.destination.index, 0, dragged);

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

            <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="view-chips" direction="horizontal">
                    {(provided) => (
                        <Box
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
                        >
                            {views.map((view, index) => (
                                <Draggable key={view.id} draggableId={`view-${view.id}`} index={index}>
                                    {(provided, snapshot) => (
                                        <Chip
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            {...provided.dragHandleProps}
                                            label={view.name}
                                            data-testid={`view-chip-${view.id}`}
                                            color={view.id === activeViewId ? 'primary' : 'default'}
                                            variant={view.id === activeViewId ? 'filled' : 'outlined'}
                                            onClick={() => handleChipClick(view)}
                                            size="small"
                                            sx={{
                                                ...(snapshot.isDragging && {
                                                    opacity: 0.8,
                                                    boxShadow: 3,
                                                }),
                                            }}
                                        />
                                    )}
                                </Draggable>
                            ))}
                            {provided.placeholder}
                        </Box>
                    )}
                </Droppable>
            </DragDropContext>

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
