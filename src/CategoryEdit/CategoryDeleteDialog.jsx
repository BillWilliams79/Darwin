import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const CategoryDeleteDialog = ({ categoryDeleteDialogOpen, setCategoryDeleteDialogOpen, categoryInfo, setCategoryInfo, setCategoryDeleteConfirmed }) => {

    const { categoryName, prioritiesCount } = categoryInfo;

    let priorityString = ` and its ${prioritiesCount} related priorities?`;

    if (prioritiesCount === undefined) {
        priorityString = '?';
    } else if (prioritiesCount === 0) {
        priorityString = '? This category has no priorities.';
    } else if (prioritiesCount === 1) {
        priorityString = ' and its 1 related priority?';
    }

    const dialogCleanUp = () => {
        setCategoryDeleteDialogOpen(false);
        setCategoryInfo({});
    };

    const clickDeleteCategory = (event) => {
        setCategoryDeleteConfirmed(true);
        setCategoryDeleteDialogOpen(false);
    };

    return (
        <Dialog open={categoryDeleteDialogOpen}
                onClose={dialogCleanUp}
                data-testid="category-edit-delete-dialog" >

            <DialogTitle>
                {"Delete Category?"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText>
                    {`Permanently delete the category ${categoryName}${priorityString}`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={clickDeleteCategory} variant="outlined" color="error">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default CategoryDeleteDialog
