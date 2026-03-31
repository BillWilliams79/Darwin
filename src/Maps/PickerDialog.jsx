import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { DataGrid, useGridApiRef } from '@mui/x-data-grid';

const PickerDialog = ({
    open,
    onClose,
    title,
    entityLabel,
    rows,
    selectedIds,
    onApply,
    onRename,
}) => {
    const apiRef = useGridApiRef();
    const [pendingIds, setPendingIds] = useState([]);

    // Sync pending selection when dialog opens
    useEffect(() => {
        if (open) setPendingIds([...selectedIds]);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const selectionModel = { type: 'include', ids: new Set(pendingIds) };

    const handleSelectionChange = (model) => {
        // v8: model is { type, ids: Set }
        const ids = model?.ids ? [...model.ids] : [];
        setPendingIds(ids);
    };

    const handleApply = () => {
        onApply(pendingIds);
        onClose();
    };

    const handleClear = () => {
        onApply([]);
        onClose();
    };

    const handleProcessRowUpdate = async (newRow, oldRow) => {
        if (newRow.name === oldRow.name) return oldRow;
        const name = newRow.name.trim();
        if (!name) return oldRow;
        try {
            await onRename(newRow.id, name);
            return { ...newRow, name };
        } catch {
            return oldRow;
        }
    };

    const columns = [
        {
            field: 'name',
            headerName: `${entityLabel} Name`,
            flex: 1,
            editable: true,
        },
        {
            field: 'ride_count',
            headerName: 'Rides',
            width: 90,
            type: 'number',
            align: 'right',
            headerAlign: 'right',
        },
    ];

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            data-testid={`${entityLabel.toLowerCase()}-picker-dialog`}
        >
            <DialogTitle>{title}</DialogTitle>
            <DialogContent sx={{ pb: 0 }}>
                <DataGrid
                    apiRef={apiRef}
                    rows={rows}
                    columns={columns}
                    checkboxSelection
                    rowSelectionModel={selectionModel}
                    onRowSelectionModelChange={handleSelectionChange}
                    processRowUpdate={handleProcessRowUpdate}
                    onCellClick={(params) => {
                        if (params.field === 'name' && apiRef.current.getCellMode(params.id, params.field) === 'view') {
                            apiRef.current.startCellEditMode({ id: params.id, field: params.field });
                        }
                    }}
                    initialState={{
                        sorting: { sortModel: [{ field: 'name', sort: 'asc' }] },
                    }}
                    autoHeight
                    disableRowSelectionOnClick
                    density="compact"
                    hideFooter
                    sx={{ mt: 1 }}
                />
            </DialogContent>
            <DialogActions>
                <Button
                    size="small"
                    onClick={handleClear}
                    disabled={pendingIds.length === 0 && selectedIds.length === 0}
                >
                    Clear
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button size="small" onClick={onClose}>Cancel</Button>
                <Button size="small" variant="contained" onClick={handleApply}>
                    Apply
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default PickerDialog;
