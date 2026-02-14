// eslint-disable-next-line no-unused-vars
import varDump from '../classifier/classifier';

import React, {useState, useContext, useEffect, useRef, useCallback} from 'react';
import call_rest_api from '../RestApi/RestApi';
import TaskCard from './TaskCard';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useApiTrigger } from '../hooks/useApiTrigger';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useDragTabStore } from '../stores/useDragTabStore';

import CardCloseDialog from '../Components/CardClose/CardCloseDialog';

import { useDrop } from 'react-dnd';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';

const AreaTabPanel = ( { domain, domainIndex, activeTab } ) => {

    const clearDragTabSwitch = useDragTabStore(s => s.clearDragTabSwitch);

    // Tab Panel contains all the taskcards for a given domain
    // Parent is TaskCardContent. Children are TaskCards

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);

    const [areasArray, setAreasArray] = useState()
    const [areaApiTrigger, triggerAreaRefresh] = useApiTrigger();

    const showError = useSnackBarStore(s => s.showError);

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
                    } else {
                        showError(result, `Unable to close ${areaName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to close ${areaName}`)
                });
        }
    });

    // READ AREA API data for TabPanel
    useEffect( () => {

        console.count('useEffect: read all Rest API data');

        let areaUri = `${darwinUri}/areas?creator_fk=${profile.userName}&closed=0&domain_fk=${domain.id}&fields=id,area_name,domain_fk,sort_order,sort_mode,creator_fk`;

        call_rest_api(areaUri, 'GET', '', idToken)
            .then(result => {
                
                if (result.httpStatus.httpStatus === 200) {

                    // Sort the data, find largest sort order, add template area/card and save the state
                    result.data.sort((areaA,areaB) => areaSortBySortOrder(areaA, areaB));
                    let maxSortOrder = result.data.at(-1).sort_order + 1
                    result.data.push({'id':'', 'area_name':'', 'domain_fk': domain.id, 'closed': 0, 'sort_order': maxSortOrder, 'sort_mode': 'priority', 'creator_fk': profile.userName, });
                    setAreasArray(result.data);

                } else {
                    showError(result, 'Unable to read Area data')
                }

            }).catch(error => {
                if (error.httpStatus.httpStatus === 404) {

                    // a domain with no areas, still requires a template area
                    setAreasArray([{'id':'', 'area_name':'', 'domain_fk': domain.id, 'sort_order': 1, 'sort_mode': 'priority', 'creator_fk': profile.userName, }]);
                } else {
                    showError(error, 'Unable to read Area data')
                }
            });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [areaApiTrigger]);

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
                    newAreasArray.push({'id':'', 'area_name':'', 'closed': 0, 'domain_fk': domain.id, 'creator_fk': profile.userName, 'sort_order': newSortOrder });
                    setAreasArray(newAreasArray);

                } else if (result.httpStatus.httpStatus === 201) {

                    // 201 => record added to database but new data not returned in body
                    // show snackbar and flip read_rest_api state to initiate full data retrieval
                    triggerAreaRefresh();

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

    const areaSortBySortOrder = (areaA, areaB) => {

        if (areaA.sort_order === areaB.sort_order) {
            return 0;
        } else if (areaA.sort_order < areaB.sort_order) {
            return -1;
        } else {
            return 1;
        }
    }

    // --- Area card drag-and-drop reordering ---
    const areasBeforeDrag = useRef(null);

    const moveCard = useCallback((fromIndex, toIndex) => {
        setAreasArray(prev => {
            if (!prev) return prev;
            // snapshot the pre-drag state on first move
            if (areasBeforeDrag.current === null) {
                areasBeforeDrag.current = prev;
            }
            const updated = [...prev];
            const [moved] = updated.splice(fromIndex, 1);
            updated.splice(toIndex, 0, moved);
            return updated;
        });
    }, []);

    const persistAreaOrder = useCallback((didDrop) => {
        if (!didDrop) {
            // drag cancelled — revert to pre-drag snapshot
            if (areasBeforeDrag.current) {
                setAreasArray(areasBeforeDrag.current);
            }
            areasBeforeDrag.current = null;
            return;
        }

        areasBeforeDrag.current = null;

        // renumber sort_order 0,1,2,... and bulk PUT
        setAreasArray(prev => {
            if (!prev) return prev;

            const restDataArray = prev
                .filter(area => area.id !== '')
                .map((area, index) => ({ id: area.id, sort_order: index }));

            // update sort_order in local state
            const updated = prev.map((area, index) => {
                if (area.id !== '') {
                    return { ...area, sort_order: index };
                }
                return area;
            });

            // persist to API
            let uri = `${darwinUri}/areas`;
            call_rest_api(uri, 'PUT', restDataArray, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                        showError(result, 'Unable to save area sort order');
                    }
                }).catch(error => {
                    showError(error, 'Unable to save area sort order');
                });

            return updated;
        });
    }, [darwinUri, idToken]);

    const removeArea = useCallback((areaId) => {
        setAreasArray(prev => {
            if (!prev) return prev;
            const updated = prev.filter(area => area.id !== areaId);
            // renumber sort_order for remaining real cards
            const renumbered = updated.map((area, index) => {
                if (area.id !== '') {
                    return { ...area, sort_order: index };
                }
                return area;
            });

            // persist new sort orders to API
            const restDataArray = renumbered
                .filter(area => area.id !== '')
                .map(area => ({ id: area.id, sort_order: area.sort_order }));

            if (restDataArray.length > 0) {
                let uri = `${darwinUri}/areas`;
                call_rest_api(uri, 'PUT', restDataArray, idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                            showError(result, 'Unable to save area sort order');
                        }
                    }).catch(error => {
                        showError(error, 'Unable to save area sort order');
                    });
            }

            areasBeforeDrag.current = null;
            return renumbered;
        });
    }, [darwinUri, idToken]);

    const [, panelDrop] = useDrop(() => ({
        accept: ['areaCard', 'taskPlan'],
        canDrop: (item, monitor) => {
            // Always accept tasks — acts as catch-all to prevent browser snap-back
            if (monitor.getItemType() === 'taskPlan') return true;
            // Accept foreign area cards not yet adopted, and already-adopted foreign cards
            if (item.sourceDomainId) return item.sourceDomainId !== domain.id;
            return item.domainId !== domain.id;
        },
        hover: (item, monitor) => {
            // Only area cards get hover adoption, not tasks
            if (monitor.getItemType() !== 'areaCard') return;
            // Already in this domain — nothing to do
            if (item.domainId === domain.id) return;

            const currentAreas = areasArray || [];

            // Return-to-origin: card was never removed from this domain's array.
            // Clean up the adoption from the other domain and restore item state.
            if (currentAreas.find(a => a.id === item.areaId)) {
                if (item.removeFromTarget) item.removeFromTarget();
                item.areaIndex = currentAreas.findIndex(a => a.id === item.areaId);
                item.domainId = domain.id;
                item.sourceDomainId = undefined;
                item.removeFromTarget = undefined;
                item.persistInTarget = undefined;
                return;
            }

            // Normal adoption: insert foreign card into this domain's areasArray
            const insertIndex = currentAreas.filter(a => a.id !== '').length;

            setAreasArray(prev => {
                if (!prev) return prev;
                if (prev.find(a => a.id === item.areaId)) return prev;
                const newArea = { ...item.areaData, domain_fk: domain.id, _isAdopted: true };
                const templateIdx = prev.findIndex(a => a.id === '');
                const updated = [...prev];
                if (templateIdx >= 0) {
                    updated.splice(templateIdx, 0, newArea);
                } else {
                    updated.push(newArea);
                }
                return updated;
            });

            item.sourceDomainId = item.domainId;
            item.domainId = domain.id;
            item.areaIndex = insertIndex;

            // Lock until React commits the insertion
            item.movePending = true;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    item.movePending = false;
                });
            });

            // Store cleanup function for cancel case
            item.removeFromTarget = () => {
                setAreasArray(prev => {
                    if (!prev) return prev;
                    return prev.filter(a => a.id !== item.areaId);
                });
                areasBeforeDrag.current = null;
            };

            // Store persist function for successful drop
            item.persistInTarget = () => {
                areasBeforeDrag.current = null;
                setAreasArray(prev => {
                    if (!prev) return prev;
                    const updated = prev.map((a, idx) => {
                        if (a.id === '') return a;
                        const { _isAdopted, ...clean } = a;
                        return { ...clean, sort_order: idx };
                    });

                    const restDataArray = updated
                        .filter(a => a.id !== '')
                        .map(a => ({
                            id: a.id,
                            sort_order: a.sort_order,
                            ...(a.id === item.areaId ? { domain_fk: domain.id } : {}),
                        }));

                    let uri = `${darwinUri}/areas`;
                    call_rest_api(uri, 'PUT', restDataArray, idToken)
                        .then(result => {
                            if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                                showError(result, 'Unable to move area to domain');
                            }
                        }).catch(error => {
                            showError(error, 'Unable to move area to domain');
                        });

                    return updated;
                });
            };
        },
        drop: (item, monitor) => {
            // If a child (TaskCard) already handled the drop, don't interfere
            if (monitor.didDrop()) return;

            // Task dropped on panel background (not on a card) — treat as cancel.
            // Returning {task: null} prevents browser snap-back and tells TaskEdit it's a cancel.
            if (monitor.getItemType() === 'taskPlan') {
                return { task: null };
            }

            if (!item.persistInTarget) {
                // Direct drop without hover adoption (fallback)
                const areaData = item.areaData;
                const newSortOrder = areasArray
                    ? Math.max(0, ...areasArray.filter(a => a.id !== '').map(a => a.sort_order)) + 1
                    : 0;

                setAreasArray(prev => {
                    if (!prev) return prev;
                    const newArea = { ...areaData, domain_fk: domain.id, sort_order: newSortOrder };
                    const templateIndex = prev.findIndex(a => a.id === '');
                    const updated = [...prev];
                    if (templateIndex >= 0) {
                        updated.splice(templateIndex, 0, newArea);
                    } else {
                        updated.push(newArea);
                    }
                    return updated;
                });

                let uri = `${darwinUri}/areas`;
                call_rest_api(uri, 'PUT', [{ id: areaData.id, domain_fk: domain.id, sort_order: newSortOrder }], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus !== 200 && result.httpStatus.httpStatus !== 204) {
                            showError(result, 'Unable to move area to domain');
                        }
                    }).catch(error => {
                        showError(error, 'Unable to move area to domain');
                    });
            }

            clearDragTabSwitch();
            return { crossDomain: true };
        },
    }), [domain.id, areasArray, darwinUri, idToken, clearDragTabSwitch]);

    return (
            <Box key={domainIndex} role="tabpanel" hidden={String(activeTab) !== String(domainIndex)}
                 className="app-content-tabpanel"
                 sx={{ p: 3 }}
            >
                { areasArray &&
                    <Box className="card" ref={panelDrop}>
                        { areasArray.map((area, areaIndex) => (
                            <TaskCard {...{key: area.id,
                                           area,
                                           areaIndex,
                                           domainId: domain.id,
                                           areaChange,
                                           areaKeyDown,
                                           areaOnBlur,
                                           clickCardClosed,
                                           moveCard,
                                           persistAreaOrder,
                                           removeArea,
                                           isTemplate: area.id === '',}}/>
                        ))}
                    </Box>  
                }
                <CardCloseDialog cardSettingsDialogOpen={areaClose.dialogOpen}
                                 setCardSettingsDialogOpen={areaClose.setDialogOpen}
                                 areaCloseId={areaClose.infoObject}
                                 setAreaCloseId={areaClose.setInfoObject}
                                 setAreaCloseConfirmed={areaClose.setConfirmed}
                />
            </Box>
    )
}

export default AreaTabPanel