import '../index.css';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';

import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { CircularProgress, Typography } from '@mui/material';

const getDevServerColumns = (navigate) => [
    { field: 'id',             headerName: 'ID',        width: 70 },
    {
        field: 'port',
        headerName: 'Port',
        width: 100,
        renderCell: (params) => (
            <Chip label={params.value} size="small" color="primary"
                  data-testid="chip-dev-server-port" />
        ),
    },
    { field: 'pid',            headerName: 'PID',       width: 90,  type: 'number' },
    { field: 'workspace_path', headerName: 'Workspace',  width: 300, flex: 1 },
    {
        field: 'session_fk',
        headerName: 'Session',
        width: 100,
        renderCell: (params) => params.value
            ? <a href={`/swarm/session/${params.value}`}
                 onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigate(`/swarm/session/${params.value}`); }}
                 data-testid="dev-server-session-link">
                #{params.value}
              </a>
            : '—',
    },
    {
        field: 'started_at',
        headerName: 'Started',
        width: 170,
        valueFormatter: (value) => value ? new Date(value).toLocaleString() : '—',
    },
];

const DevServersView = () => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const navigate = useNavigate();

    const [devServersArray, setDevServersArray] = useState(null);
    const showError = useSnackBarStore(s => s.showError);

    useEffect(() => {
        const devServersUri = `${darwinUri}/dev_servers?creator_fk=${profile.userName}`;

        call_rest_api(devServersUri, 'GET', '', idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    setDevServersArray(result.data);
                } else {
                    setDevServersArray([]);
                }
            }).catch(error => {
                if (error.httpStatus && error.httpStatus.httpStatus === 404) {
                    setDevServersArray([]);
                } else {
                    showError(error, 'Unable to read dev servers');
                }
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Box sx={{ gridArea: 'content', p: 3 }}>
            <Typography variant="h5" sx={{ mb: 1 }}>Dev Servers</Typography>

            {devServersArray === null ? (
                <CircularProgress />
            ) : (
                <Box sx={{ height: 600, width: '100%' }} data-testid="dev-servers-datagrid">
                    <DataGrid
                        rows={devServersArray}
                        columns={getDevServerColumns(navigate)}
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
                        sx={{ cursor: 'default' }}
                        data-testid="dev-servers-grid"
                    />
                </Box>
            )}
        </Box>
    );
};

export default DevServersView;
