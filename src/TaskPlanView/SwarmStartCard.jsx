// SwarmStartCard — mirrors CategoryCard in the Roadmap view but:
//   • Fetches all swarm_ready requirements (global, cross-category)
//   • No template row — "add new" is not supported
//   • All other UI interactions are identical to CategoryCard

import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import RequirementRow from '../SwarmView/RequirementRow';
import RequirementDeleteDialog from '../SwarmView/RequirementDeleteDialog';
import call_rest_api from '../RestApi/RestApi';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useSwarmReadyRequirements, useSessions, useCategoryColors } from '../hooks/useDataQueries';
import { requirementKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { RequirementActionsContext } from '../hooks/useRequirementActions';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Check from '@mui/icons-material/Check';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { CircularProgress } from '@mui/material';

const SwarmStartCard = () => {
    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [requirementsArray, setRequirementsArray] = useState();
    const [sessionStatusMap, setSessionStatusMap] = useState({});
    const [sortMode, setSortMode] = useState('hand');
    const [menuAnchorEl, setMenuAnchorEl] = useState(null);
    const menuOpen = Boolean(menuAnchorEl);

    const showError = useSnackBarStore(s => s.showError);

    // Fetch all swarm_ready requirements (global)
    const { data: serverRequirements } = useSwarmReadyRequirements(profile?.userName);

    // Fetch sessions for status badges (same as CategoryCard)
    const { data: serverSessions } = useSessions(profile?.userName);

    // Fetch category colors so each row can show a color bar for its source category
    const { data: serverCategoryColors } = useCategoryColors(profile?.userName);
    const categoryColorMap = React.useMemo(() => {
        if (!serverCategoryColors) return {};
        const map = {};
        serverCategoryColors.forEach(c => { if (c.color) map[c.id] = c.color; });
        return map;
    }, [serverCategoryColors]);

    const createdSort = (a, b) => a.id - b.id;
    const requirementHandSort = (a, b) => {
        const aOrder = a.sort_order ?? Infinity;
        const bOrder = b.sort_order ?? Infinity;
        return aOrder - bOrder;
    };

    // Seed local state from server data
    useEffect(() => {
        if (!serverRequirements) return;
        const sorted = [...serverRequirements];
        sorted.sort((a, b) => sortMode === 'hand' ? requirementHandSort(a, b) : createdSort(a, b));
        setRequirementsArray(sorted);
    }, [serverRequirements]); // eslint-disable-line react-hooks/exhaustive-deps

    // Build session status map (same logic as CategoryCard)
    useEffect(() => {
        if (!serverSessions || serverSessions.length === 0) return;
        const map = {};
        serverSessions.forEach(s => {
            const m = s.source_ref && s.source_ref.match(/^(priority|requirement):(\d+)$/);
            if (m) {
                const pid = parseInt(m[2]);
                if (!map[pid] || s.id > map[pid].id) {
                    map[pid] = { id: s.id, swarm_status: s.swarm_status };
                }
            }
        });
        const flatMap = {};
        for (const [k, v] of Object.entries(map)) {
            flatMap[k] = v.swarm_status;
        }
        setSessionStatusMap(flatMap);
    }, [serverSessions]);

    const handleMenuOpen = (e) => setMenuAnchorEl(e.currentTarget);
    const handleMenuClose = () => setMenuAnchorEl(null);

    const changeSortMode = (newMode) => {
        handleMenuClose();
        setSortMode(newMode);
        if (requirementsArray) {
            const sorted = [...requirementsArray];
            sorted.sort((a, b) => newMode === 'hand' ? requirementHandSort(a, b) : createdSort(a, b));
            setRequirementsArray(sorted);
        }
    };

    // Delete dialog (same as CategoryCard)
    const requirementDelete = useConfirmDialog({
        onConfirm: ({ requirementId }) => {
            call_rest_api(`${darwinUri}/requirements`, 'DELETE', { id: requirementId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        setRequirementsArray(prev => prev ? prev.filter(p => p.id !== requirementId) : prev);
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete requirement');
                    }
                }).catch(error => showError(error, 'Unable to delete requirement'));
        }
    });

    // Status click — mirrors CategoryCard; items that cycle off swarm_ready leave the card
    const STATUS_CYCLE = ['authoring', 'approved', 'swarm_ready'];
    const statusClick = (requirementIndex, requirementId) => {
        const newRequirementsArray = [...requirementsArray];
        const current = newRequirementsArray[requirementIndex].requirement_status;
        const idx = STATUS_CYCLE.indexOf(current);
        if (idx === -1) return;
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
        newRequirementsArray[requirementIndex].requirement_status = next;

        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, requirement_status: next }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, 'Unable to change requirement status');
                } else {
                    // Item is no longer swarm_ready — remove from this card
                    if (next !== 'swarm_ready') {
                        setRequirementsArray(prev => prev ? prev.filter(p => p.id !== requirementId) : prev);
                        queryClient.invalidateQueries({ queryKey: requirementKeys.all(profile.userName) });
                    }
                }
            }).catch(error => showError(error, 'Unable to change requirement status'));

        setRequirementsArray(newRequirementsArray);
    };

    // Coordination click — mirrors CategoryCard
    const COORD_CYCLE = [null, 'planned', 'implemented', 'deployed'];
    const coordinationClick = (requirementIndex, requirementId) => {
        const newRequirementsArray = [...requirementsArray];
        const current = newRequirementsArray[requirementIndex].coordination_type || null;
        const idx = COORD_CYCLE.indexOf(current);
        const next = COORD_CYCLE[(idx + 1) % COORD_CYCLE.length];
        newRequirementsArray[requirementIndex].coordination_type = next;
        setRequirementsArray(newRequirementsArray);

        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, coordination_type: next === null ? 'NULL' : next }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                    showError(result, 'Unable to change coordination type');
                }
            }).catch(error => showError(error, 'Unable to change coordination type'));
    };

    // Title editing — mirrors CategoryCard (PUT only, no POST/template)
    const updateRequirement = (event, requirementIndex, requirementId) => {
        if (!requirementId || requirementId === '' || !requirementsArray) return;
        call_rest_api(`${darwinUri}/requirements`, 'PUT',
            [{ id: requirementId, title: requirementsArray[requirementIndex].title }], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 204) {
                    showError(result, 'Requirement title not updated');
                }
            }).catch(error => showError(error, 'Requirement title not updated'));
    };

    const { fieldChange: titleChange, fieldKeyDown: titleKeyDown, fieldOnBlur: titleOnBlur } = useCrudCallbacks({
        items: requirementsArray || [],
        setItems: setRequirementsArray,
        fieldName: 'title',
        saveFn: updateRequirement,
    });

    const deleteClick = (event, requirementId) => {
        const requirement = requirementsArray?.find(p => p.id === requirementId);
        requirementDelete.openDialog({
            requirementId,
            title: requirement?.title || '',
            coordination_type: requirement?.coordination_type || null,
            requirement_status: requirement?.requirement_status || 'swarm_ready',
        });
    };

    // No same-card DnD reordering for a cross-category aggregation card
    const setCrossCardInsertIndex = useCallback(() => {}, []);

    return (
        <Card raised={true}
              data-testid="swarm-start-card"
              sx={{ border: '2px solid transparent' }}>
            <CardContent>
                <Box className="card-header" sx={{ marginBottom: 2 }}>
                    <Typography sx={{ fontSize: 24, fontWeight: 'normal' }}>
                        Swarm Ready
                    </Typography>
                    <IconButton
                        onClick={handleMenuOpen}
                        data-testid="swarm-start-card-menu"
                        size="small"
                        sx={{ maxWidth: '25px', maxHeight: '25px' }}
                    >
                        <MoreVertIcon />
                    </IconButton>
                    <Menu
                        anchorEl={menuAnchorEl}
                        open={menuOpen}
                        onClose={handleMenuClose}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    >
                        <MenuItem onClick={() => changeSortMode('hand')} data-testid="swarm-start-sort-hand">
                            <ListItemIcon><SwapVertIcon fontSize="small" /></ListItemIcon>
                            <ListItemText>Hand Sort</ListItemText>
                            {sortMode === 'hand' && <Check fontSize="small" sx={{ ml: 1 }} />}
                        </MenuItem>
                        <MenuItem onClick={() => changeSortMode('created')} data-testid="swarm-start-sort-created">
                            <ListItemIcon><AccessTimeIcon fontSize="small" /></ListItemIcon>
                            <ListItemText>Created Sort</ListItemText>
                            {sortMode === 'created' && <Check fontSize="small" sx={{ ml: 1 }} />}
                        </MenuItem>
                    </Menu>
                </Box>

                {requirementsArray === undefined ? (
                    <CircularProgress size={24} />
                ) : requirementsArray.length === 0 ? (
                    <Typography variant="body2" sx={{ color: 'text.disabled', p: 1 }}>
                        No swarm-ready requirements
                    </Typography>
                ) : (
                    <RequirementActionsContext.Provider value={{
                        statusClick, coordinationClick,
                        titleChange, titleKeyDown, titleOnBlur,
                        deleteClick,
                        requirementsArray,
                        setRequirementsArray,
                        sortMode: 'created', // suppress insert indicators — no same-card reorder
                        setCrossCardInsertIndex,
                        sessionStatusMap,
                        categoryColorMap,
                    }}>
                        {requirementsArray.map((requirement, requirementIndex) => (
                            <RequirementRow
                                key={requirement.id}
                                supportDrag={false}
                                requirement={requirement}
                                requirementIndex={requirementIndex}
                                categoryId={String(requirement.category_fk)}
                                categoryName=""
                            />
                        ))}
                    </RequirementActionsContext.Provider>
                )}
            </CardContent>
            <RequirementDeleteDialog
                deleteDialogOpen={requirementDelete.dialogOpen}
                setDeleteDialogOpen={requirementDelete.setDialogOpen}
                setDeleteId={requirementDelete.setInfoObject}
                setDeleteConfirmed={requirementDelete.setConfirmed}
                requirement={requirementDelete.infoObject}
            />
        </Card>
    );
};

export default SwarmStartCard;
