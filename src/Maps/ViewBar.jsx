import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';

const ViewBar = ({ views, activeViewId, onViewSelect, onCreateClick, onEditClick }) => {
    const handleChipClick = (view) => {
        if (view.id === activeViewId) {
            // Clicking the already-active view opens edit
            onEditClick(view);
        } else {
            onViewSelect(view.id);
        }
    };

    return (
        <Box
            data-testid="view-bar"
            sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                px: 2,
                py: 1,
                alignItems: 'center',
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

            {views.map(view => (
                <Chip
                    key={view.id}
                    label={view.name}
                    data-testid={`view-chip-${view.id}`}
                    color={view.id === activeViewId ? 'primary' : 'default'}
                    variant={view.id === activeViewId ? 'filled' : 'outlined'}
                    onClick={() => handleChipClick(view)}
                    size="small"
                />
            ))}

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
