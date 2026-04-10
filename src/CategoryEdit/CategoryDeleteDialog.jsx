import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const CategoryDeleteDialog = ({ categoryDeleteDialogOpen, setCategoryDeleteDialogOpen, categoryInfo, setCategoryInfo, setCategoryDeleteConfirmed }) => {

    const { categoryName, requirementsCount } = categoryInfo;

    let requirementString = ` and its ${requirementsCount} related requirements?`;

    if (requirementsCount === undefined) {
        requirementString = '?';
    } else if (requirementsCount === 0) {
        requirementString = '? This category has no requirements.';
    } else if (requirementsCount === 1) {
        requirementString = ' and its 1 related requirement?';
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
                    {`Permanently delete the category ${categoryName}${requirementString}`}
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
