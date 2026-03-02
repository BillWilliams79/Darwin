import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import { renderSourceRef } from './repoGitHubMap.jsx';
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { CircularProgress, Typography } from '@mui/material';

const swarmStatusColor = (status) => {
    switch (status) {
        case 'starting':   return 'info';
        case 'active':     return 'primary';
        case 'paused':     return 'warning';
        case 'completing': return 'info';
        case 'completed':  return 'success';
        default:           return 'default';
    }
};

const getSessionColumns = (navigate) => [
    { field: 'id',           headerName: 'ID',          width: 70 },
    {
        field: 'swarm_status',
        headerName: 'Status',
        width: 120,
        renderCell: (params) => (
            <Chip label={params.value} size="small"
                  color={swarmStatusColor(params.value)}
                  data-testid="chip-swarm-status" />
        ),
    },
    { field: 'task_name',    headerName: 'Task',        width: 200, flex: 1 },
    { field: 'title',        headerName: 'Title',       width: 250 },
    {
        field: 'source_ref',
        headerName: 'Source',
        width: 140,
        renderCell: (params) => renderSourceRef(params.value, navigate),
    },
    { field: 'branch',       headerName: 'Branch',      width: 200 },
    {
        field: 'pr_url',
        headerName: 'Pull Request',
        width: 80,
        renderCell: (params) => params.value
            ? <a href={params.value} target="_blank" rel="noopener noreferrer"
                 onClick={(e) => e.stopPropagation()}
                 data-testid="session-pr-url">PR</a>
            : '—',
    },
    { field: 'worker_count', headerName: 'Workers',     width: 80,  type: 'number' },
    {
        field: 'started_at',
        headerName: 'Started',
        width: 170,
        valueFormatter: (value) => value ? new Date(value).toLocaleString() : '—',
    },
    {
        field: 'completed_at',
        headerName: 'Completed',
        width: 170,
        valueFormatter: (value) => value ? new Date(value).toLocaleString() : '—',
    },
];

const SessionsView = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const navigate = useNavigate();

    const [sessionsArray, setSessionsArray] = useState(null);
    const showError = useSnackBarStore(s => s.showError);

    useEffect(() => {
        const sessionsUri = `${darwinUri}/swarm_sessions?creator_fk=${profile.userName}`;

        call_rest_api(sessionsUri, 'GET', '', idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setSessionsArray(result.data);
                } else {
                    setSessionsArray([]);
                }
            }).catch(error => {
                if (error.httpStatus && error.httpStatus.httpStatus === 404) {
                    setSessionsArray([]);
                } else {
                    showError(error, 'Unable to read swarm sessions');
                }
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Box sx={{ gridArea: 'content', p: 3 }}>
            <Typography variant="h5" gutterBottom>Swarm Sessions</Typography>

            {sessionsArray === null ? (
                <CircularProgress />
            ) : (
                <Box sx={{ height: 600, width: '100%' }} data-testid="sessions-datagrid">
                    <DataGrid
                        rows={sessionsArray}
                        columns={getSessionColumns(navigate)}
                        slots={{ toolbar: GridToolbar }}
                        slotProps={{
                            toolbar: {
                                showQuickFilter: true,
                            },
                        }}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 25 } },
                            sorting: { sortModel: [{ field: 'id', sort: 'desc' }] },
                        }}
                        pageSizeOptions={[10, 25, 50, 100]}
                        disableRowSelectionOnClick
                        onRowClick={(params) => navigate(`/swarm/session/${params.id}`)}
                        sx={{ cursor: 'pointer' }}
                        data-testid="sessions-grid"
                    />
                </Box>
            )}
        </Box>
    );
};

export default SessionsView;
