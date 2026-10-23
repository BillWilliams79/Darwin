// EngineHistoryStrip.jsx — the engine's recent cycles, one cell each, oldest
// left (req #3760, user action A20 "scrub engine history").
//
// A click (or ←/→ with the strip focused) selects a cycle; the panels above
// then show THAT record, read back unchanged from storage. "Latest" returns
// to following the newest record as it arrives. A cell's colour says whether
// the cycle was trusted and whether it admitted anything; its height, how much
// was queued. Below the strip: what changed between the selected cycle and the
// one before it.

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { codeColor } from './engineVocabulary';
import { stampText } from './engineModel';
import { PanelTitle } from './enginePanelParts';

const cellColor = (c) => (!c.ok ? codeColor('ENGINE_HOLD')
    : c.admitted > 0 ? codeColor('ADMITTED') : codeColor('CAPACITY'));

export default function EngineHistoryStrip({
    engineId, cells, selectedId, following, onSelect, onFollow, changes, timezone,
}) {
    const index = cells.findIndex((c) => c.id === selectedId);
    const maxQueued = Math.max(1, ...cells.map((c) => c.queued));
    const move = (delta) => {
        const next = cells[index + delta];
        if (next) onSelect(next.id);
    };
    const onKeyDown = (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
    };
    return (
        <Box data-testid={`engine-history-${engineId}`}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PanelTitle>History · {cells.length} cycle{cells.length === 1 ? '' : 's'}</PanelTitle>
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" aria-label="Earlier cycle" disabled={index <= 0}
                            onClick={() => move(-1)} data-testid={`engine-history-prev-${engineId}`}>
                    <ChevronLeftIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" aria-label="Later cycle"
                            disabled={index < 0 || index >= cells.length - 1}
                            onClick={() => move(1)} data-testid={`engine-history-next-${engineId}`}>
                    <ChevronRightIcon fontSize="small" />
                </IconButton>
                <Button size="small" variant={following ? 'contained' : 'outlined'} onClick={onFollow}
                        aria-pressed={following ? 'true' : 'false'}
                        data-testid={`engine-history-latest-${engineId}`}>
                    Latest
                </Button>
            </Box>
            {cells.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No decision records stored.</Typography>
            ) : (
                <Box role="listbox" tabIndex={0} aria-label="Engine cycles" onKeyDown={onKeyDown}
                     sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 36,
                           overflowX: 'auto', pb: 0.5, outline: 'none',
                           '&:focus-visible': { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}` } }}>
                    {cells.map((c) => {
                        const selected = c.id === selectedId;
                        return (
                            <Tooltip key={c.id} title={`cycle ${c.seq} · ${stampText(c.at, timezone)} · `
                                + `${c.verdict} · ${c.admitted} admitted of ${c.queued} queued`}>
                                <Box role="option" aria-selected={selected ? 'true' : 'false'}
                                     data-testid={`engine-history-cell-${engineId}-${c.id}`}
                                     data-seq={c.seq}
                                     onClick={() => onSelect(c.id)}
                                     sx={{ width: 12, flexShrink: 0, cursor: 'pointer', borderRadius: '2px',
                                           height: `${30 + Math.round(70 * (c.queued / maxQueued))}%`,
                                           bgcolor: cellColor(c),
                                           opacity: selected ? 1 : 0.55,
                                           outline: selected ? '2px solid' : 'none',
                                           outlineColor: 'text.primary', outlineOffset: '1px' }} />
                            </Tooltip>
                        );
                    })}
                </Box>
            )}
            {changes && (
                <Box data-testid={`engine-changes-${engineId}`} sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                        {changes.length === 0 ? 'Nothing changed from the cycle before.'
                            : 'Changed from the cycle before:'}
                    </Typography>
                    {changes.length > 0 && (
                        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                            {changes.map((line, i) => (
                                <Typography key={i} component="li" variant="body2">{line}</Typography>
                            ))}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}
