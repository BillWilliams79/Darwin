import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDrop } from 'react-dnd';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { recurringTaskKeys } from '../hooks/useQueryKeys';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';

import RecurringTaskRow from './RecurringTaskRow';
import RecurringDeleteDialog from './RecurringDeleteDialog';

const RecurringAreaCard = ({ area, definitions }) => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: recurringTaskKeys.all(profile.userName) });

    // Hybrid local state: TanStack Query seeds via useEffect; local state owns DnD
    const [localDefs, setLocalDefs] = useState(definitions);
    useEffect(() => { setLocalDefs(definitions); }, [definitions]);

    // Tab-after-save coordination: focus recurrence Select on newly created row
    const [focusRecurrenceId, setFocusRecurrenceId] = useState(null);
    const focusAfterSaveRef = useRef(false);

    const handleTabAfterSave = useCallback(() => {
        focusAfterSaveRef.current = true;
    }, []);

    const clearAutoFocusRecurrence = useCallback(() => {
        setFocusRecurrenceId(null);
    }, []);

    const handleRemove = useCallback((defId) => {
        setLocalDefs(prev => prev.filter(d => d.id !== defId));
    }, []);

    const [{ isOver }, drop] = useDrop(() => ({
        accept: ['recurringTask'],
        drop: (item) => {
            if (String(item.area_fk) === String(area.id)) return { def: null }; // same card, no-op

            // Optimistic: add def to this card immediately
            setLocalDefs(prev => [...prev, { ...item, area_fk: parseInt(area.id) }]);

            call_rest_api(`${darwinUri}/recurring_tasks`, 'PUT', [{ id: item.id, area_fk: area.id }], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus > 204) {
                        setLocalDefs(prev => prev.filter(d => d.id !== item.id));
                        showError(result, 'Unable to move recurring task');
                    } else {
                        invalidate();
                    }
                })
                .catch(error => {
                    setLocalDefs(prev => prev.filter(d => d.id !== item.id));
                    showError(error, 'Unable to move recurring task');
                });

            return { def: item.id };
        },
        collect: (monitor) => ({
            isOver: monitor.isOver(),
        }),
    }), [area, darwinUri, idToken, showError, queryClient, profile]);

    const handleSave = async (formData) => {
        const result = await call_rest_api(`${darwinUri}/recurring_tasks`, 'POST', formData, idToken);
        if (result.httpStatus.httpStatus > 201) { showError(result, 'Unable to create'); return; }
        if (result.data?.[0]) {
            const newRow = result.data[0];
            setLocalDefs(prev => [...prev, newRow]);
            if (focusAfterSaveRef.current) {
                focusAfterSaveRef.current = false;
                setFocusRecurrenceId(newRow.id);
            }
        }
        invalidate();
    };

    const handleUpdate = async (patch) => {
        const result = await call_rest_api(`${darwinUri}/recurring_tasks`, 'PUT', [patch], idToken);
        if (result.httpStatus.httpStatus > 204) { showError(result, 'Unable to update'); }
        invalidate();
    };

    const recurringDelete = useConfirmDialog({
        onConfirm: async (def) => {
            const result = await call_rest_api(`${darwinUri}/recurring_tasks`, 'DELETE', { id: def.id }, idToken);
            if (result.httpStatus.httpStatus > 204) { showError(result, 'Unable to delete'); return; }
            invalidate();
        }
    });

    const handleDelete = (def) => {
        recurringDelete.openDialog(def);
    };

    return (
        <Card raised={true} ref={drop} data-testid={`recurring-area-card-${area.id}`}
              sx={{
                  border: isOver ? '2px solid' : '2px solid transparent',
                  borderColor: isOver ? 'primary.main' : 'transparent',
              }}>
            <CardContent>
                {/* Card header — identical to TaskCard */}
                <Box className="card-header" sx={{ marginBottom: 2 }}>
                    <TextField
                        variant="standard"
                        value={area.area_name || ''}
                        name="area-name"
                        multiline
                        autoComplete="off"
                        size="small"
                        slotProps={{
                            input: { disableUnderline: true, style: { fontSize: 24 } },
                            htmlInput: { maxLength: 32 },
                        }}
                    />
                </Box>

                {/* Recurring task rows */}
                {localDefs.map(def => (
                    <RecurringTaskRow
                        key={def.id}
                        def={def}
                        areaId={area.id}
                        isTemplate={false}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        onRemove={handleRemove}
                        autoFocusRecurrence={focusRecurrenceId === def.id}
                        clearAutoFocusRecurrence={clearAutoFocusRecurrence}
                    />
                ))}

                {/* Blank template row */}
                <RecurringTaskRow
                    key={`template-${area.id}`}
                    def={null}
                    areaId={area.id}
                    isTemplate={true}
                    onSave={handleSave}
                    onTabAfterSave={handleTabAfterSave}
                />
            </CardContent>
            <RecurringDeleteDialog
                open={recurringDelete.dialogOpen}
                setOpen={recurringDelete.setDialogOpen}
                def={recurringDelete.infoObject}
                setConfirmed={recurringDelete.setConfirmed}
            />
        </Card>
    );
};

export default RecurringAreaCard;
