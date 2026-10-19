import React, { useEffect } from 'react';
import { useDragLayer } from 'react-dnd';
import Box from '@mui/material/Box';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { REQ_CARD_MONO, REQ_CARD_THEME as T } from './requirementCardTheme';

const layerStyles = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: 1500,
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
};

const RequirementDragLayer = () => {
    const { itemType, isDragging, item, currentOffset } = useDragLayer((monitor) => ({
        item: monitor.getItem(),
        itemType: monitor.getItemType(),
        currentOffset: monitor.getSourceClientOffset(),
        isDragging: monitor.isDragging(),
    }));

    useEffect(() => {
        if (isDragging) {
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.userSelect = '';
            window.getSelection()?.removeAllRanges();
        }
        return () => { document.body.style.userSelect = ''; };
    }, [isDragging]);

    if (!isDragging || !currentOffset || itemType !== 'requirementRow') {
        return null;
    }

    const transform = `translate(${currentOffset.x}px, ${currentOffset.y}px) scale(0.67)`;

    return (
        <div style={layerStyles}>
            {/* req #3644 — the preview wears the row's new shape: the plan's
                dark panel, the mono id, the title, the ⋮. The colour key is
                the host card's, so the preview's id stays in neutral text. */}
            <Box className="task requirement-row" sx={{
                transform,
                WebkitTransform: transform,
                transformOrigin: 'top left',
                width: item?.sourceWidth || 300,
                opacity: 0.85,
                bgcolor: T.panel,
                border: `1px solid ${T.line}`,
                boxShadow: 3,
                borderRadius: `${T.fieldRadius}px`,
                px: 1, py: 0.5,
            }}>
                <Box sx={{ fontFamily: REQ_CARD_MONO, fontWeight: 700, color: T.text, minWidth: '5.5ch', pr: 1 }}>
                    {item?.id}
                </Box>
                <Box sx={{ color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                           ...(item?.requirement_status === 'met' && { textDecoration: 'line-through' }),
                           ...((item?.requirement_status === 'deferred' || item?.requirement_status === 'wontfix') && { opacity: 0.5 }) }}>
                    {item?.title || ''}
                </Box>
                <MoreVertIcon fontSize="small" sx={{ color: T.dim }} />
            </Box>
        </div>
    );
};

export default RequirementDragLayer;
