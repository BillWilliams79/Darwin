// NewPipelineCard.jsx — create trial B (req #3773): a dashed "New pipeline"
// tile at the end of the Cards grid. Clicking it turns the tile into a title
// field; Enter creates a draft plan with every other column at its default
// (Parallel, Any machine, no goal) and opens it. Esc, or leaving the field
// empty, puts the tile back.
//
// The quick path, where trial A (`NewPipelineDialog.jsx`) is the full form.
// Both write through `useCreatePipeline`.

import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';

import useCreatePipeline from './useCreatePipeline';

const TILE_SX = {
    borderStyle: 'dashed',
    borderWidth: 2,
    minHeight: 180,
    display: 'flex',
    flexDirection: 'column',
    bgcolor: 'transparent',
};

export default function NewPipelineCard() {
    const { create, creating } = useCreatePipeline();
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState('');

    const cancel = () => {
        if (creating) return;
        setEditing(false);
        setTitle('');
    };
    const commit = async () => {
        if (await create({ title })) {
            setEditing(false);
            setTitle('');
        }
    };

    if (!editing) {
        return (
            <Card variant="outlined" sx={TILE_SX} data-testid="pipelines-new-card">
                <CardActionArea onClick={() => setEditing(true)} sx={{ flex: 1 }}
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

    return (
        <Card variant="outlined" sx={{ ...TILE_SX, borderColor: 'primary.main' }}
              data-testid="pipelines-new-card">
            <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column',
                               justifyContent: 'center', gap: 1.5 }}>
                <TextField autoFocus fullWidth size="small" label="New pipeline title"
                           value={title}
                           disabled={creating}
                           onChange={(e) => setTitle(e.target.value)}
                           onKeyDown={(e) => {
                               if (e.key === 'Enter') { e.preventDefault(); commit(); }
                               if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                           }}
                           onBlur={() => { if (!title.trim()) cancel(); }}
                           inputProps={{ 'data-testid': 'pipelines-new-card-title' }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                        Enter creates a draft and opens it · Esc cancels
                    </Typography>
                    {/* `onMouseDown` preventDefault keeps the field focused, so
                        its blur-when-empty does not fold the tile away under
                        the click. */}
                    <Button size="small" onMouseDown={(e) => e.preventDefault()} onClick={cancel}
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
