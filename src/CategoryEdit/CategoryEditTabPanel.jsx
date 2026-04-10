import React, {useState, useContext, useEffect, useRef} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { useCategories, useRequirementCounts } from '../hooks/useDataQueries';
import { categoryKeys } from '../hooks/useQueryKeys';
import { useCrudCallbacks } from '../hooks/useCrudCallbacks';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

import call_rest_api from '../RestApi/RestApi';
import AuthContext from '../Context/AuthContext';
import AppContext from '../Context/AppContext';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';

import Box from '@mui/material/Box';
import { Typography } from '@mui/material';

import CategoryDeleteDialog from './CategoryDeleteDialog';
import CategoryTableRow from './CategoryTableRow';
import { CATEGORY_GRID_COLUMNS } from './CategoryTableRow';

const DEFAULT_CATEGORY_COLOR = '#4A90D9';

const CategoryEditTabPanel = ( { project, projectIndex, activeTab } ) => {

    const { idToken, profile } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const queryClient = useQueryClient();

    const [categoriesArray, setCategoriesArray] = useState();
    const [requirementCounts, setRequirementCounts] = useState({});
    const templateInputRef = useRef(null);

    const showError = useSnackBarStore(s => s.showError);

    // TanStack Query — fetch categories for this project (open + closed) and requirement counts
    const { data: serverCategories } = useCategories(profile?.userName, project.id, {
        fields: 'id,category_name,closed,sort_order,color',
    });
    const { data: serverRequirementCounts } = useRequirementCounts(profile?.userName);

    // Seed local state from query data
    useEffect(() => {
        if (serverCategories) {
            const sorted = [...serverCategories];
            sorted.sort((a, b) => categorySortByClosedThenSortOrder(a, b));
            sorted.push({'id':'', 'category_name':'', 'closed': 0, 'project_fk': parseInt(project.id), 'sort_order': null, 'color': DEFAULT_CATEGORY_COLOR });
            setCategoriesArray(sorted);
        } else if (serverCategories && serverCategories.length === 0) {
            setCategoriesArray([{'id':'', 'category_name':'', 'closed': 0, 'project_fk': parseInt(project.id), 'color': DEFAULT_CATEGORY_COLOR }]);
        }
    }, [serverCategories]);

    // Compute requirement counts from query data
    useEffect(() => {
        if (serverRequirementCounts) {
            const newRequirementCounts = {};
            serverRequirementCounts.forEach((countData) => {
                newRequirementCounts[countData.category_fk] = countData['count(*)'];
            });
            setRequirementCounts(newRequirementCounts);
        }
    }, [serverRequirementCounts]);

    const categoryDelete = useConfirmDialog({
        onConfirm: ({ categoryId }) => {
            let uri = `${darwinUri}/categories`;
            call_rest_api(uri, 'DELETE', {'id': categoryId}, idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus === 200) {
                        let newCategoriesArray = [...categoriesArray];
                        newCategoriesArray = newCategoriesArray.filter(cat => cat.id !== categoryId);
                        setCategoriesArray(newCategoriesArray);
                        queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                    } else {
                        showError(result, 'Unable to delete category');
                    }
                }).catch(error => {
                    showError(error, 'Unable to delete category');
                });
        }
    });

    const restUpdateCategoryName = (categoryIndex, categoryId) => {

        const noop = ()=>{};

        if ((categoryId === '') &&
            (categoriesArray[categoryIndex].category_name === '')) {
            noop();
        } else {
            if (categoryId === '') {
                restSaveNewCategory(categoryIndex);
            } else {
                let uri = `${darwinUri}/categories`;
                call_rest_api(uri, 'PUT', [{'id': categoryId, 'category_name': categoriesArray[categoryIndex].category_name}], idToken)
                    .then(result => {
                        if (result.httpStatus.httpStatus > 204) {
                            showError(result, 'Unable to update category');
                        }
                    }).catch(error => {
                        showError(error, 'Unable to update category');
                    });
            }
        }
    }

    const { fieldChange: changeCategoryName, fieldKeyDown: keyDownCategoryName, fieldOnBlur: blurCategoryName } = useCrudCallbacks({
        items: categoriesArray, setItems: setCategoriesArray, fieldName: 'category_name',
        saveFn: (_event, index, id) => restUpdateCategoryName(index, id)
    });

    const changeCategoryColor = (event, categoryIndex, categoryId) => {
        const newColor = event.target.value;
        let newCategoriesArray = [...categoriesArray];
        newCategoriesArray[categoryIndex].color = newColor;
        setCategoriesArray(newCategoriesArray);

        if (categoryId !== '') {
            let uri = `${darwinUri}/categories`;
            call_rest_api(uri, 'PUT', [{'id': categoryId, 'color': newColor}], idToken)
                .then(result => {
                    if (result.httpStatus.httpStatus > 204) {
                        showError(result, 'Unable to update category color');
                    }
                }).catch(error => {
                    showError(error, 'Unable to update category color');
                });
        }
    };

    const restSaveNewCategory = (categoryIndex) => {

        let newCategoriesArray = [...categoriesArray];
        newCategoriesArray[categoryIndex].sort_order = calculateSortOrder(newCategoriesArray, categoryIndex, newCategoriesArray[categoryIndex].closed);

        let uri = `${darwinUri}/categories`;
        call_rest_api(uri, 'POST', {...newCategoriesArray[categoryIndex]}, idToken)
            .then(result => {
                if (result.httpStatus.httpStatus === 200) {
                    newCategoriesArray[categoryIndex] = {...result.data[0]};
                    newCategoriesArray.sort((a, b) => categorySortByClosedThenSortOrder(a, b));
                    newCategoriesArray.push({'id':'', 'category_name':'', 'closed': 0, 'project_fk': project.id, 'sort_order': null, 'color': DEFAULT_CATEGORY_COLOR });
                    setCategoriesArray(newCategoriesArray);

                    let newRequirementCounts = {...requirementCounts};
                    newRequirementCounts[result.data[0].id] = 0;
                    setRequirementCounts(newRequirementCounts);

                    queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                    setTimeout(() => templateInputRef.current?.focus(), 0);

                } else if (result.httpStatus.httpStatus === 201) {
                    queryClient.invalidateQueries({ queryKey: categoryKeys.all(profile.userName) });
                } else {
                    showError(result, 'Unable to save new category');
                }
            }).catch(error => {
                showError(error, 'Unable to save new category');
            });
    }

    const clickCategoryClosed = (event, categoryIndex, categoryId) => {

        let newCategoriesArray = [...categoriesArray];
        let newClosed = newCategoriesArray[categoryIndex].closed ? 0 : 1;
        newCategoriesArray[categoryIndex].closed = newClosed;

        if (newCategoriesArray[categoryIndex].id === '') {
            setCategoriesArray(newCategoriesArray);
            return;
        }

        var newSortOrder = calculateSortOrder(newCategoriesArray, categoryIndex, newClosed);

        let uri = `${darwinUri}/categories`;
        call_rest_api(uri, 'PUT', [{'id': categoryId, 'closed': newClosed, 'sort_order': newSortOrder}], idToken)
            .then(result => {
                if (result.httpStatus.httpStatus > 200) {
                    showError(result, 'Unable to close category');
                }
            }).catch(error => {
                showError(error, 'Unable to close category');
            });

        newCategoriesArray.sort((a, b) => categorySortByClosedThenSortOrder(a, b));
        setCategoriesArray(newCategoriesArray);
    }

    const clickCategoryDelete = (event, categoryId, categoryName) => {
        categoryDelete.openDialog({ categoryName, categoryId, requirementsCount: requirementCounts[categoryId] });
    }

    const categorySortByClosedThenSortOrder = (a, b) => {
        if (a.id === '') return 0;
        if (b.id === '') return -1;

        if ((a.closed === 0) && (b.closed === 0)) {
            if (a.sort_order === b.sort_order) return 0;
            if (a.sort_order === null) return 1;
            if (b.sort_order === null) return -1;
            return a.sort_order < b.sort_order ? -1 : 1;
        }

        if (a.closed === b.closed) return 0;
        return a.closed > b.closed ? 1 : -1;
    }

    const calculateSortOrder = (arr, index, newClosed) => {
        var calcSortOrder = "NULL";

        if (newClosed === 0) {
            calcSortOrder = arr.reduce((previous, current) => {
                if (current.sort_order === null) return previous;
                return (previous > current.sort_order) ? previous : current.sort_order;
            }, -1);
            calcSortOrder = calcSortOrder + 1;
        }
        arr[index].sort_order = (calcSortOrder === "NULL") ? null : calcSortOrder;
        return calcSortOrder;
    }

    const dragEnd = async (result) => {

        if ((result.destination === null) || (result.reason !== 'DROP')) {
            return;
        }

        var newCategoriesArray = [...categoriesArray];
        const [draggedItem] = newCategoriesArray.splice(result.source.index, 1);
        newCategoriesArray.splice(result.destination.index, 0, draggedItem);

        newCategoriesArray = newCategoriesArray.map((cat, index) => {
            if ((cat.id !== '') && (cat.closed !== 1)) {
                cat.sort_order = index;
                return cat;
            } else {
                return cat;
            }
        });

        setCategoriesArray(newCategoriesArray);

        var restDataArray = newCategoriesArray
                .filter(cat => ((cat.id !== '') && (cat.sort_order !== null)) ? true : false)
                .map(cat => ({'id': cat.id, 'sort_order': cat.sort_order}));

        let uri = `${darwinUri}/categories`;
        call_rest_api(uri, 'PUT', restDataArray, idToken)
            .then(result => {
                if ((result.httpStatus.httpStatus === 200) ||
                    (result.httpStatus.httpStatus === 204)) {
                    // success
                } else {
                    showError(result, 'Unable to save category sort order');
                }
            }).catch(error => {
                showError(error, 'Unable to save category sort order');
            });
    }

    return (
        <>
            <Box key={projectIndex} role="tabpanel" hidden={String(activeTab) !== String(projectIndex)} sx={{ p: { xs: 1, md: 3 } }} >
                { categoriesArray &&
                    <Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: CATEGORY_GRID_COLUMNS, alignItems: 'center', borderBottom: 1, borderColor: 'divider', pb: 0.5, mb: 0.5 }}>
                            <Box />
                            <Box sx={{ px: 1 }}><Typography variant="subtitle2">Name</Typography></Box>
                            <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Closed</Typography></Box>
                            <Box sx={{ textAlign: 'center' }}><Typography variant="subtitle2">Requirements</Typography></Box>
                            <Box />
                        </Box>
                        <DragDropContext onDragEnd={dragEnd}>
                            <Droppable droppableId="categories">
                                {(provided) => (
                                    <Box {...provided.droppableProps} ref={provided.innerRef}>
                                        { categoriesArray
                                            .filter(c => c.closed === 0 && c.id !== '')
                                            .map((category, idx) => (
                                            <CategoryTableRow
                                                key = {category.id}
                                                category = {category}
                                                categoryIndex = {idx}
                                                changeCategoryName = {changeCategoryName}
                                                changeCategoryColor = {changeCategoryColor}
                                                keyDownCategoryName = {keyDownCategoryName}
                                                blurCategoryName = {blurCategoryName}
                                                clickCategoryClosed = {clickCategoryClosed}
                                                clickCategoryDelete = {clickCategoryDelete}
                                                requirementCounts = {requirementCounts}
                                                isDraggable />
                                        ))}
                                        {provided.placeholder}
                                    </Box>
                                )}
                            </Droppable>
                        </DragDropContext>
                        { categoriesArray
                            .filter(c => c.closed === 1 || c.id === '')
                            .map((category) => (
                            <CategoryTableRow
                                key = {category.id || 'template'}
                                category = {category}
                                categoryIndex = {categoriesArray.indexOf(category)}
                                changeCategoryName = {changeCategoryName}
                                changeCategoryColor = {changeCategoryColor}
                                keyDownCategoryName = {keyDownCategoryName}
                                blurCategoryName = {blurCategoryName}
                                clickCategoryClosed = {clickCategoryClosed}
                                clickCategoryDelete = {clickCategoryDelete}
                                requirementCounts = {requirementCounts}
                                isDraggable={false}
                                inputRef={category.id === '' ? templateInputRef : undefined} />
                        ))}
                    </Box>
                }
            </Box>
            <CategoryDeleteDialog
                categoryDeleteDialogOpen = { categoryDelete.dialogOpen }
                setCategoryDeleteDialogOpen = { categoryDelete.setDialogOpen }
                categoryInfo = { categoryDelete.infoObject }
                setCategoryInfo = { categoryDelete.setInfoObject }
                setCategoryDeleteConfirmed = { categoryDelete.setConfirmed } />
        </>
    )
}

export default CategoryEditTabPanel
