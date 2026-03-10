import React, { useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { recurringTaskKeys } from '../hooks/useQueryKeys';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';

import RecurringTaskRow from './RecurringTaskRow';

const RecurringAreaCard = ({ area, definitions }) => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: recurringTaskKeys.all(profile.userName) });

    const handleSave = async (formData) => {
        const result = await call_rest_api(`${darwinUri}/recurring_tasks`, 'POST', formData, idToken);
        if (result.httpStatus.httpStatus > 201) { showError(result, 'Unable to create'); return; }
        invalidate();
    };

    const handleUpdate = async (patch) => {
        const result = await call_rest_api(`${darwinUri}/recurring_tasks`, 'PUT', [patch], idToken);
        if (result.httpStatus.httpStatus > 204) { showError(result, 'Unable to update'); }
        invalidate();
    };

    const handleDelete = async (def) => {
        if (!window.confirm(`Delete "${def.description}"?`)) return;
        const result = await call_rest_api(`${darwinUri}/recurring_tasks`, 'DELETE', { id: def.id }, idToken);
        if (result.httpStatus.httpStatus > 204) { showError(result, 'Unable to delete'); return; }
        invalidate();
    };

    return (
        <Card raised={true}>
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
                {definitions.map(def => (
                    <RecurringTaskRow
                        key={def.id}
                        def={def}
                        areaId={area.id}
                        isTemplate={false}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                    />
                ))}

                {/* Blank template row */}
                <RecurringTaskRow
                    key={`template-${area.id}`}
                    def={null}
                    areaId={area.id}
                    isTemplate={true}
                    onSave={handleSave}
                />
            </CardContent>
        </Card>
    );
};

export default RecurringAreaCard;
