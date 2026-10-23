import React, {useState, useContext, useEffect} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import call_rest_api from '../RestApi/RestApi';
import CategoryCard from './CategoryCard';
import SwarmStartCard from '../TaskPlanView/SwarmStartCard';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useCategories } from '../hooks/useDataQueries';
import { categoryKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import CategoryCloseDialog from './CategoryCloseDialog';
import CategoryDeleteDialog from './CategoryDeleteDialog';

import { DarwinSortableList, useDarwinDropZone, useRegisterList, withPlacement } from '../dnd';
import { CATEGORY_CARDS, swarmIds, useSwarmSession } from './swarmDnd';
import AuthContext from '../Context/AuthContext'
import AppContext from '../Context/AppContext';

import Box from '@mui/material/Box';

// req #3428 — `initiativeReqIds` is the initiative filter's SCOPE, passed straight through
// from the page to both card kinds. A Set of requirement ids, or `null` when no
// filter is active. This panel neither reads the URL nor derives membership: the
// host owns the filter, and one derivation upstairs is what stops the aggregator
// and the category cards from disagreeing about what the initiative contains.
// req #3503 — `epicReqIds` is the EPIC filter's scope, the sibling of the above
// and threaded the same way. Independent of it: both may be non-null at once and
// the cards apply them in series.
const CategoryTabPanel = ( { project, projectIndex, activeTab, showClosed, showSwarmStartCard, initiativeReqIds = null, epicReqIds = null } ) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [categoriesArray, setCategoriesArray] = useState()

    const showError = useSnackBarStore(s => s.showError);

    // TanStack Query — fetch categories for this project
    const { data: serverCategories } = useCategories(profile?.userName, project.id, {
        closed: showClosed ? undefined : 0,
    });

    // Seed local state from query data
    useEffect(() => {
        if (serverCategories && serverCategories.length > 0) {
            const sorted = [...serverCategories];
            sorted.sort((a, b) => categorySortBySortOrder(a, b));
            let maxSortOrder = sorted.at(-1).sort_order + 1;
            sorted.push({'id':'', 'category_name':'', 'project_fk': project.id, 'closed': 0, 'sort_order': maxSortOrder, 'sort_mode': 'process', });
            setCategoriesArray(sorted);
        } else if (serverCategories && serverCategories.length === 0) {
            setCategoriesArray([{'id':'', 'category_name':'', 'project_fk': project.id, 'sort_order': 1, 'sort_mode': 'process', }]);
        }
    }, [serverCategories]);

    const categoryClose = useConfirmDialog({
        onConfirm: ({ categoryName, categoryId }) => {
            let uri = `${darwinUri}/categories`;
            call_rest_api(uri, 'PUT', [{'id': categoryId, 'closed': 1, 'sort_order': 'NULL'}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        if (showClosed) {
                            let newCategoriesArray = categoriesArray.map(cat =>
                                cat.id === categoryId ? { ...cat, closed: 1, sort_order: null } : cat
                            );
                            setCategoriesArray(newCategoriesArray);
                        } else {
                            let newCategoriesArray = [...categoriesArray];
                            newCategoriesArray = newCategoriesArray.filter(cat => cat.id !== categoryId );
                            setCategoriesArray(newCategoriesArray);
                        }
                        queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to close ${categoryName}`)
                    }
                }).catch(error => {
                    showError(error, `Unable to close ${categoryName}`)
                });
        }
    });

    const categoryDelete = useConfirmDialog({
        onConfirm: ({ categoryId, categoryName }) => {
            let uri = `${darwinUri}/categories`;
            call_rest_api(uri, 'DELETE', { 'id': categoryId }, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newCategoriesArray = [...categoriesArray];
                        newCategoriesArray = newCategoriesArray.filter(cat => cat.id !== categoryId);
                        setCategoriesArray(newCategoriesArray);
                        queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                    } else {
                        showError(result, `Unable to delete ${categoryName}`);
                    }
                }).catch(error => {
                    showError(error, `Unable to delete ${categoryName}`);
                });
        }
    });

    const updateCategory = (event, categoryIndex, categoryId) => {

        const noop = ()=>{};

        if ((categoryId === '') &&
            (categoriesArray[categoryIndex].category_name === '')) {
            noop();
        } else {
            if (categoryId === '') {
                saveCategory(event, categoryIndex)
            } else {
                let uri = `${darwinUri}/categories`;
                call_rest_api(uri, 'PUT', [{'id': categoryId, 'category_name': categoriesArray[categoryIndex].category_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            showError(result, `Unable to update category name`)
                        }
                    }).catch(error => {
                        showError(error, `Unable to update category name`)
                    });
            }
        }
    }

    const { fieldChange: categoryChange, fieldKeyDown: categoryKeyDown, fieldOnBlur: categoryOnBlur } = useCrudCallbacks({
        items: categoriesArray, setItems: setCategoriesArray, fieldName: 'category_name', saveFn: updateCategory
    });

    const saveCategory = (category, categoryIndex) => {

        let newCategoriesArray = [...categoriesArray];
        let uri = `${darwinUri}/categories`;
        call_rest_api(uri, 'POST', {...newCategoriesArray[categoryIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    newCategoriesArray[categoryIndex] = {...result.data[0]};
                    let newSortOrder = result.data[0].sort_order + 1;
                    newCategoriesArray.push({'id':'', 'category_name':'', 'closed': 0, 'project_fk': project.id, 'sort_order': newSortOrder, 'sort_mode': 'process' });
                    setCategoriesArray(newCategoriesArray);
                    queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                } else if (result.httpStatus.httpStatus === 201) {
                    queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                } else {
                    showError(result, `Unable to save new category`)
                }
            }).catch(error => {
                showError(error, `Unable to save new category`)
            });
    }

    const clickCardClosed = (event, categoryName, categoryId) => {
        if (categoryId !== '') {
            categoryClose.openDialog({ categoryName, categoryId });
        }
    }

    const clickCardDelete = (event, categoryName, categoryId, requirementCount) => {
        if (categoryId !== '') {
            categoryDelete.openDialog({ categoryName, categoryId, requirementCount });
        }
    }

    const categorySortBySortOrder = (a, b) => {
        if (a.sort_order === b.sort_order) return 0;
        if (a.sort_order < b.sort_order) return -1;
        return 1;
    }

    // --- Category card drag and drop (req #3663) ---
    // The grid is one sortable list; the page resolves every drop (useSwarmDnd)
    // and writes through this registration. While a card from ANOTHER project
    // is carried in here (tab hover-switch), it renders at its placement and
    // the cards around it slide aside — derived from the drag session, never
    // written into categoriesArray, so a cancel leaves nothing behind. An
    // inactive panel is hidden, not unmounted; its zones are switched off.
    const panelActive = String(activeTab) === String(projectIndex);
    const categoriesListId = swarmIds.categories(project.id);
    useRegisterList(categoriesListId, {
        getItems: () => categoriesArray || [],
        setItems: setCategoriesArray,
        ready: !!categoriesArray,
        projectId: project.id,
    });
    const { setNodeRef: panelDropRef } = useDarwinDropZone({
        id: categoriesListId, policy: CATEGORY_CARDS, disabled: !panelActive,
    });
    const { active: dragActive, placement } = useSwarmSession(categoriesListId);
    const renderedCategories = withPlacement(categoriesArray, categoriesListId,
        { active: dragActive, placement }, CATEGORY_CARDS.isTarget);
    const sortableCategoryIds = (renderedCategories || [])
        .filter(CATEGORY_CARDS.isTarget)
        .map(category => swarmIds.category(category.id));

    return (
            <Box key={projectIndex} role="tabpanel" hidden={!panelActive}
                 className="app-content-tabpanel"
                 sx={{ p: 3 }}
            >
                { categoriesArray &&
                    <DarwinSortableList id={categoriesListId} items={sortableCategoryIds} policy={CATEGORY_CARDS}>
                    <Box className="card swarm-card" ref={panelDropRef}>
                        {showSwarmStartCard && <SwarmStartCard projectId={project.id} panelActive={panelActive}
                                                               initiativeReqIds={initiativeReqIds} epicReqIds={epicReqIds} />}
                        { renderedCategories.map((category) => (
                            <CategoryCard {...{key: category.id,
                                           category,
                                           // The index into categoriesArray, which every
                                           // inline-edit handler addresses — not the
                                           // position on screen, which a card carried
                                           // in from another project shifts mid-drag.
                                           categoryIndex: categoriesArray.indexOf(category),
                                           projectId: project.id,
                                           categoryChange,
                                           categoryKeyDown,
                                           categoryOnBlur,
                                           clickCardClosed,
                                           clickCardDelete,
                                           isTemplate: category.id === '',
                                           showClosed,
                                           panelActive,
                                           initiativeReqIds,
                                           epicReqIds,}}/>
                        ))}
                    </Box>
                    </DarwinSortableList>
                }
                <CategoryCloseDialog dialogOpen={categoryClose.dialogOpen}
                                 setDialogOpen={categoryClose.setDialogOpen}
                                 closeInfo={categoryClose.infoObject}
                                 setCloseInfo={categoryClose.setInfoObject}
                                 setCloseConfirmed={categoryClose.setConfirmed}
                />
                <CategoryDeleteDialog deleteDialogOpen={categoryDelete.dialogOpen}
                                  setDeleteDialogOpen={categoryDelete.setDialogOpen}
                                  categoryDeleteInfo={categoryDelete.infoObject}
                                  setCategoryDeleteInfo={categoryDelete.setInfoObject}
                                  setDeleteConfirmed={categoryDelete.setConfirmed}
                />
            </Box>
    )
}

export default CategoryTabPanel
