import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const CategoryDeleteDialog = ({ deleteDialogOpen, setDeleteDialogOpen, categoryDeleteInfo, setCategoryDeleteInfo, setDeleteConfirmed }) => {

    const { categoryName, requirementCount } = categoryDeleteInfo;

    const truncatedName = categoryName && categoryName.length > 20
        ? categoryName.substring(0, 20) + '...'
        : categoryName;

    const dialogCleanUp = () => {
        setDeleteDialogOpen(false);
        setCategoryDeleteInfo({});
    };

    const confirmDelete = () => {
        setDeleteConfirmed(true);
        setDeleteDialogOpen(false);
    };

    const actionText = requirementCount === 0
        ? `Delete "${truncatedName}"? This category has no requirements.`
        : `Delete "${truncatedName}" and its ${requirementCount} requirement${requirementCount === 1 ? '' : 's'}?`;

    return (
        <Dialog open={deleteDialogOpen}
                onClose={dialogCleanUp}
                data-testid="category-delete-dialog" >

            <DialogTitle>
                {"Delete Category"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText>
                    {actionText}
                </DialogContentText>
                <DialogContentText sx={{ mt: 2 }}>
                    This cannot be undone.
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={confirmDelete} variant="outlined" color="error">
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
