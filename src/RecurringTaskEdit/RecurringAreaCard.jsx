import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { recurringTaskKeys } from '../hooks/useQueryKeys';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { DarwinSortableList, useDarwinDropZone, useRegisterList } from '../dnd';
import { RECURRING_TASKS, recurringIds, useRecurringDragStore } from './recurringDnd';

import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';

import RecurringTaskRow from './RecurringTaskRow';
import RecurringDeleteDialog from './RecurringDeleteDialog';

const RecurringAreaCard = ({ area, definitions, panelActive = true }) => {
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

    // --- Drag and drop (req #3663) ---
    // The card is a drop zone that takes a recurring task as a whole (they have
    // no stored order): it highlights while one hovers, and the page's one
    // onDragEnd (useRecurringDnd) moves the row through this registration. A
    // hidden domain's cards take no part until a tab hover-switch shows them.
    const listId = recurringIds.tasks(area.id);
    useRegisterList(listId, {
        getItems: () => localDefs,
        setItems: setLocalDefs,
        ready: true,
        areaId: area.id,
    });
    const { setNodeRef: dropRef } = useDarwinDropZone({ id: listId, policy: RECURRING_TASKS, disabled: !panelActive });
    const highlighted = useRecurringDragStore(s => s.highlight === listId);

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
        <Card raised={true} ref={dropRef} data-testid={`recurring-area-card-${area.id}`}
              data-drop-highlight={highlighted ? 'true' : undefined}
              sx={(theme) => ({
                  transition: 'border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease',
                  border: '2px solid',
                  borderColor: highlighted ? 'primary.main' : 'transparent',
                  // Drop-target affordance: tint + lift while a task hovers.
                  ...(highlighted && {
                      backgroundColor: alpha(theme.palette.primary.main, 0.06),
                      boxShadow: `0 6px 18px ${alpha(theme.palette.primary.main, 0.35)}`,
                  }),
              })}>
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

                {/* Recurring task rows — each lifts; the card takes no position */}
                <DarwinSortableList id={listId} items={localDefs.map(d => recurringIds.task(d.id))}
                                    policy={RECURRING_TASKS}>
                {localDefs.map(def => (
                    <RecurringTaskRow
                        key={def.id}
                        def={def}
                        areaId={area.id}
                        isTemplate={false}
                        drag={{ id: recurringIds.task(def.id), type: 'recurring', containerId: listId,
                                policy: RECURRING_TASKS, disabled: !panelActive }}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        autoFocusRecurrence={focusRecurrenceId === def.id}
                        clearAutoFocusRecurrence={clearAutoFocusRecurrence}
                    />
                ))}
                </DarwinSortableList>

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
