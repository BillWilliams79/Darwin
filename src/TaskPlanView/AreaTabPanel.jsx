// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, {useState, useContext, useEffect} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import call_rest_api from '../RestApi/RestApi';
import TaskCard from './TaskCard';
import PriorityCard from './PriorityCard';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useAreas } from '../hooks/useDataQueries';
import { areaKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useOptionalCardStore } from '../stores/useOptionalCardStore';
import { DarwinSortableList, useDarwinDropZone } from '../dnd';
import { AREA_CARDS, planIds, usePlanSession, useRegisterPlanList } from './planDnd';
import { withPlacement } from './planMoves';

import CardCloseDialog from '../Components/CardClose/CardCloseDialog';
import AreaDeleteDialog from '../Components/AreaDeleteDialog/AreaDeleteDialog';

import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';

const AreaTabPanel = ( { domain, domainIndex, activeTab } ) => {

    // Optional card show states — toggle lives in TaskPlanView tab bar
    const showPriorityCard = useOptionalCardStore(s => s.cards[String(domain.id)]?.priority?.show ?? false);

    // Tab Panel contains all the taskcards for a given domain
    // Parent is TaskCardContent. Children are TaskCards

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [areasArray, setAreasArray] = useState()
    const [newlyCreatedAreaId, setNewlyCreatedAreaId] = useState(null)

    const showError = useSnackBarStore(s => s.showError);

    // TanStack Query — fetch open areas for this domain
    const { data: serverAreas } = useAreas(profile?.userName, domain.id, { closed: 0 });

    // Seed local state from query data (hybrid pattern — local state owns DnD)
    useEffect(() => {
        if (serverAreas && serverAreas.length > 0) {
            const sorted = [...serverAreas];
            sorted.sort((areaA, areaB) => areaSortBySortOrder(areaA, areaB));
            let maxSortOrder = sorted.at(-1).sort_order + 1;
            sorted.push({'id':'', 'area_name':'', 'domain_fk': domain.id, 'closed': 0, 'sort_order': maxSortOrder, 'sort_mode': 'priority', });
            setAreasArray(sorted);
        } else if (serverAreas && serverAreas.length === 0) {
            setAreasArray([{'id':'', 'area_name':'', 'domain_fk': domain.id, 'sort_order': 1, 'sort_mode': 'priority', }]);
        }
    }, [serverAreas]);

    // cardSettings state
    const areaClose = useConfirmDialog({
        onConfirm: ({ areaName, areaId }) => {
            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'PUT', [{'id': areaId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newAreasArray = [...areasArray];
                        newAreasArray = newAreasArray.filter(area => area.id !== areaId );
                        setAreasArray(newAreasArray);
                        queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) });
                        // Pause recurring task definitions for this area
                        call_rest_api(`${darwinUri}/recurring_tasks?area_fk=${areaId}&fields=id`, 'GET', '', idToken)
                            .then(rtResult => {
                                if (rtResult?.data?.length > 0) {
                                    const updates = rtResult.data.map(rt => ({ id: rt.id, active: 0 }));
                                    call_rest_api(`${darwinUri}/recurring_tasks`, 'PUT', updates, idToken);
                                }
                            });
                    } else {
                        showError(result, `Unable to close ${areaName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to close ${areaName}`)
                });
        }
    });

    const areaDelete = useConfirmDialog({
        onConfirm: ({ areaId, areaName }) => {
            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'DELETE', { 'id': areaId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newAreasArray = [...areasArray];
                        newAreasArray = newAreasArray.filter(area => area.id !== areaId);
                        setAreasArray(newAreasArray);
                        queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to delete ${areaName}`);
                    }
                }).catch(error => {
                    showError(error, `Unable to delete ${areaName}`);
                });
        }
    });

    const updateArea = (event, areaIndex, areaId) => {

        const noop = ()=>{};

        if ((areaId === '') &&
            (areasArray[areaIndex].area_name === '')) {
            // new area with no description, noop
            noop();

        } else {
            // blank taskId indicates we are creating a new task rather than updating existing
            if (areaId === '') {
                saveArea(event, areaIndex)
            } else {

                // Otherwise we are updating the name of an existing area
                let uri = `${darwinUri}/areas`;
                call_rest_api(uri, 'PUT', [{'id': areaId, 'area_name': areasArray[areaIndex].area_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            // database change confirmed only with a 200/201 response
                            showError(result, `Unable to update area name`)
                        } else {
                            queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) });
                        }
                    }).catch(error => {
                        showError(error, `Unable to update area name`)
                    });
            }
        }
    }

    const { fieldChange: areaChange, fieldKeyDown: areaKeyDown, fieldOnBlur: areaOnBlur } = useCrudCallbacks({
        items: areasArray, setItems: setAreasArray, fieldName: 'area_name', saveFn: updateArea
    });

    const saveArea = (area, areaIndex, areaId) => {

        // Call rest API and create a new array
        let newAreasArray = [...areasArray];
        let uri = `${darwinUri}/areas`;
        call_rest_api(uri, 'POST', {...newAreasArray[areaIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    // 200 => record added to database and returned in body
                    // place new data in table and created another template area
                    newAreasArray[areaIndex] = {...result.data[0]};
                    let newSortOrder = result.data[0].sort_order + 1;
                    newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': domain.id, 'sort_order': newSortOrder });
                    setAreasArray(newAreasArray);
                    setNewlyCreatedAreaId(result.data[0].id);
                    queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) });

                } else if (result.httpStatus.httpStatus === 201) {

                    // 201 => record added to database but new data not returned in body
                    queryClient.invalidateQueries({ queryKey: areaKeys.all(profile.userName) });

                } else {
                    showError(result, `Unable to save new area`)
                }
            }).catch(error => {
                showError(error, `Unable to save new area`)
            });
    }

    const clickCardClosed = (event, areaName, areaId) => {
        if (areaId !== '') {
            areaClose.openDialog({ areaName, areaId });
        }
    }

    const clickCardDelete = (event, areaName, areaId, taskCount) => {
        if (areaId !== '') {
            areaDelete.openDialog({ areaName, areaId, taskCount });
        }
    }

    const areaSortBySortOrder = (areaA, areaB) => {

        if (areaA.sort_order === areaB.sort_order) {
            return 0;
        } else if (areaA.sort_order < areaB.sort_order) {
            return -1;
        } else {
            return 1;
        }
    }

    // --- Area card drag and drop (req #3662) ---
    // The grid is one sortable list; the page resolves every drop (usePlanDnd)
    // and writes through this registration. While a card from ANOTHER domain
    // is carried in here (tab hover-switch), it renders at its placement and
    // the cards around it slide aside — derived from the drag session, never
    // written into areasArray, so a cancel leaves nothing behind.
    // req #3506 — an inactive panel is HIDDEN, not unmounted, so its cards keep
    // running their queries. The closed-task reads are gated on this so the
    // "Closed" option fetches one domain's history rather than the account's;
    // its drop zones are switched off on the same signal (req #3662).
    const domainActive = String(activeTab) === String(domainIndex);
    const areasListId = planIds.areas(domain.id);
    useRegisterPlanList(areasListId, {
        getItems: () => areasArray || [],
        setItems: setAreasArray,
        ready: !!areasArray,
        domainId: domain.id,
    });
    const { setNodeRef: panelDropRef } = useDarwinDropZone({ id: areasListId, policy: AREA_CARDS, disabled: !domainActive });
    const { active: dragActive, placement } = usePlanSession(areasListId);
    const renderedAreas = withPlacement(areasArray, areasListId,
        { active: dragActive, placement }, AREA_CARDS.isTarget);
    const sortableAreaIds = (renderedAreas || [])
        .filter(AREA_CARDS.isTarget)
        .map(area => planIds.area(area.id));

    // Real area IDs (exclude template row) for PriorityCard
    const realAreaIds = areasArray ? areasArray.filter(a => a.id !== '').map(a => a.id) : [];

    return (
            <Box key={domainIndex} role="tabpanel" hidden={!domainActive}
                 className="app-content-tabpanel"
                 sx={{ p: 3 }}
            >
                { areasArray &&
                    <DarwinSortableList id={areasListId} items={sortableAreaIds} policy={AREA_CARDS}>
                    <Box className="card" ref={panelDropRef}>
                        {showPriorityCard && realAreaIds.length > 0 && (
                            <PriorityCard domainId={domain.id} areaIds={realAreaIds} domainActive={domainActive} />
                        )}
                        { renderedAreas.map((area) => (
                            <TaskCard key={area.id} {...{
                                           area,
                                           // The index into areasArray, which every
                                           // inline-edit handler addresses — not the
                                           // position on screen, which a card carried
                                           // in from another domain shifts mid-drag.
                                           areaIndex: areasArray.indexOf(area),
                                           domainId: domain.id,
                                           areaChange,
                                           areaKeyDown,
                                           areaOnBlur,
                                           clickCardClosed,
                                           clickCardDelete,
                                           domainActive,
                                           isTemplate: area.id === '',
                                           autoFocusTemplate: newlyCreatedAreaId !== null && area.id === newlyCreatedAreaId,
                                           clearAutoFocusTemplate: () => setNewlyCreatedAreaId(null),}}/>
                        ))}
                    </Box>
                    </DarwinSortableList>
                }
                <CardCloseDialog cardSettingsDialogOpen={areaClose.dialogOpen}
                                 setCardSettingsDialogOpen={areaClose.setDialogOpen}
                                 areaCloseId={areaClose.infoObject}
                                 setAreaCloseId={areaClose.setInfoObject}
                                 setAreaCloseConfirmed={areaClose.setConfirmed}
                />
                <AreaDeleteDialog deleteDialogOpen={areaDelete.dialogOpen}
                                  setDeleteDialogOpen={areaDelete.setDialogOpen}
                                  areaDeleteInfo={areaDelete.infoObject}
                                  setAreaDeleteInfo={areaDelete.setInfoObject}
                                  setDeleteConfirmed={areaDelete.setConfirmed}
                />
            </Box>
    )
}

export default AreaTabPanel
