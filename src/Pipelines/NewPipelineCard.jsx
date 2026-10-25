// NewPipelineCard.jsx — the two halves of making a plan in place (req #3804,
// replacing req #3773's trial B tile, which opened the new plan at once).
//
// `NewPipelineTile` is the dashed "+ New pipeline" tile that closes the Cards
// grid. Pressing it does not make anything yet: it puts a `NewPipelineDraftCard`
// at the FRONT of the grid — where the new plan will stand, because a new plan
// is written below every existing position — with its title field focused.
// Enter (or leaving the field with a title in it) creates the draft plan there
// and it stays put, an ordinary card; Esc, or leaving the field empty, takes the
// draft away again. Nothing navigates: the plan opens from its card.

import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';

const TILE_SX = {
    borderStyle: 'dashed',
    borderWidth: 2,
    minHeight: 180,
    display: 'flex',
    flexDirection: 'column',
    bgcolor: 'transparent',
};

/** The "+ New pipeline" tile at the end of the grid. */
export function NewPipelineTile({ onAdd, disabled = false }) {
    return (
        <Card variant="outlined" sx={TILE_SX} data-testid="pipelines-new-card">
            <CardActionArea onClick={onAdd} disabled={disabled} sx={{ flex: 1 }}
                            data-testid="pipelines-new-card-open">
                <CardContent sx={{ display: 'flex', flexDirection: 'column',
                                   alignItems: 'center', justifyContent: 'center',
                                   color: 'text.secondary' }}>
                    <AddIcon sx={{ fontSize: 48 }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        New pipeline
                    </Typography>
                </CardContent>
            </CardActionArea>
        </Card>
    );
}

/**
 * The unsaved plan at the front of the grid. `onCreate(title)` resolves true
 * once the plan is written; `onCancel()` removes the draft.
 */
export function NewPipelineDraftCard({ onCreate, onCancel, creating = false }) {
    const [title, setTitle] = useState('');

    const commit = async () => {
        if (!title.trim()) { onCancel(); return; }
        if (await onCreate(title)) setTitle('');
    };

    return (
        <Card variant="outlined" sx={{ ...TILE_SX, borderStyle: 'solid', borderColor: 'primary.main' }}
              data-testid="pipelines-draft-card">
            <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column',
                               justifyContent: 'center', gap: 1.5 }}>
                <TextField autoFocus fullWidth size="small" label="New pipeline title"
                           value={title}
                           disabled={creating}
                           onChange={(e) => setTitle(e.target.value)}
                           onKeyDown={(e) => {
                               if (e.key === 'Enter') { e.preventDefault(); commit(); }
                               if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
                           }}
                           onBlur={() => { if (!creating) commit(); }}
                           slotProps={{ htmlInput: { 'data-testid': 'pipelines-new-card-title',
                                                     maxLength: 256 } }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                        Enter creates a draft plan here · Esc cancels
                    </Typography>
                    {/* `onMouseDown` preventDefault keeps the field focused, so
                        its blur does not commit or fold the card under the click. */}
                    <Button size="small" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}
                            disabled={creating}>
                        Cancel
                    </Button>
                    <Button size="small" variant="contained"
                            onMouseDown={(e) => e.preventDefault()} onClick={commit}
                            disabled={creating || !title.trim()}
                            data-testid="pipelines-new-card-create">
                        {creating ? 'Creating…' : 'Create'}
                    </Button>
                </Box>
            </CardContent>
        </Card>
    );
}
