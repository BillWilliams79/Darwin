// /swarm/agents/:id — single-agent editor page (req #2496 Agents 2.0).
//
// Layout:
//   - Header: back button, name, darwin_id, model, tools chips
//   - Body: monospace TextField with the agent's full markdown content
//   - Save / Cancel buttons
//
// Save writes content_md to the DB. Source-of-truth file write-back is
// covered by a follow-up requirement (see PLAN.md "Write-back architecture").

import { useContext, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import call_rest_api from '../RestApi/RestApi';
import { useAgent } from '../hooks/useDataQueries';
import { agentKeys } from '../hooks/useQueryKeys';
import { formatDateTime } from '../utils/dateFormat';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';

const PAGE_WIDTH = 1100;

const splitTools = (csv) => (csv || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export default function AgentDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { darwinUri } = useContext(AppContext);
    const { idToken, profile } = useContext(AuthContext);
    const creatorFk = profile?.userName;
    const timezone = profile?.timezone;

    const { data: agent, isLoading } = useAgent(creatorFk, id);

    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, msg: '', severity: 'success' });

    useEffect(() => {
        if (agent?.body_markdown != null) {
            setDraft(agent.body_markdown);
        }
    }, [agent?.body_markdown]);

    const dirty = agent && draft !== (agent.body_markdown || '');

    const handleSave = async () => {
        if (!dirty) return;
        setSaving(true);
        try {
            const result = await call_rest_api(
                `${darwinUri}/agents`,
                'PUT',
                [{ id: agent.id, body_markdown: draft }],
                idToken,
            );
            // PUT returns 200 or 204; treat both as success
            const status = result.httpStatus?.httpStatus;
            if (status !== 200 && status !== 204) {
                throw new Error(`PUT failed: ${status}`);
            }
            queryClient.invalidateQueries({ queryKey: agentKeys.byId(creatorFk, id) });
            queryClient.invalidateQueries({ queryKey: agentKeys.all(creatorFk) });
            setSnackbar({ open: true, msg: 'Agent saved', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, msg: `Save failed: ${err.message || err}`, severity: 'error' });
        } finally {
            setSaving(false);
        }
    };

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!agent) {
        return (
            <Box sx={{ p: 3 }}>
                <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/swarm/agents')}>
                    Back to Agents
                </Button>
                <Typography sx={{ mt: 2 }}>Agent {id} not found.</Typography>
            </Box>
        );
    }

    return (
        <Box className="app-content-planpage" sx={{ pb: 4 }}>
            <Box sx={{ px: 3, pt: 3, pb: 1, maxWidth: PAGE_WIDTH }}>
                <Button startIcon={<ArrowBackIcon />}
                        onClick={() => navigate('/swarm/agents')}
                        size="small"
                        data-testid="agent-back">
                    Back to Agents
                </Button>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="h5" component="h1"
                                sx={{ fontFamily: 'monospace' }}
                                data-testid="agent-detail-name">
                        {agent.name}
                    </Typography>
                    <Chip label={`#${agent.darwin_id}`} size="small" variant="outlined"
                          sx={{ color: 'primary.main', borderColor: 'primary.main' }} />
                    {agent.model && (
                        <Chip label={agent.model} size="small" variant="outlined" />
                    )}
                </Stack>
                <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                    {splitTools(agent.tools_csv).map(t => (
                        <Chip key={t} label={t} size="small" sx={{ height: 20 }} />
                    ))}
                </Stack>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                    <code>{agent.file_path}</code> · updated {agent.update_ts ? formatDateTime(agent.update_ts, timezone) : '—'}
                </Typography>
                {agent.description && (
                    <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                        {agent.description}
                    </Typography>
                )}
            </Box>

            <Box sx={{ px: 3, maxWidth: PAGE_WIDTH }}>
                <TextField
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    multiline
                    minRows={28}
                    fullWidth
                    InputProps={{
                        sx: { fontFamily: 'monospace', fontSize: '0.85rem',
                              alignItems: 'flex-start' },
                    }}
                    data-testid="agent-markdown-editor"
                />
                <Stack direction="row" spacing={1} sx={{ mt: 1.5, justifyContent: 'flex-end' }}>
                    <Button onClick={() => setDraft(agent.body_markdown || '')}
                            disabled={!dirty || saving}
                            data-testid="agent-cancel">
                        Revert
                    </Button>
                    <Button variant="contained" startIcon={<SaveIcon />}
                            onClick={handleSave}
                            disabled={!dirty || saving}
                            data-testid="agent-save">
                        {saving ? 'Saving…' : (dirty ? 'Save' : 'Saved')}
                    </Button>
                </Stack>
            </Box>

            <Snackbar open={snackbar.open}
                      autoHideDuration={4000}
                      onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
                <Alert severity={snackbar.severity}
                       onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                       sx={{ width: '100%' }}>
                    {snackbar.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
}
