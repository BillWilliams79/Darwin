import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const CategoryCloseDialog = ({ dialogOpen, setDialogOpen, closeInfo, setCloseInfo, setCloseConfirmed }) => {

    const { categoryName } = closeInfo;

    const dialogCleanUp = () => {
        setDialogOpen(false);
        setCloseInfo({});
    };

    const closeCategory = () => {
        setCloseConfirmed(true);
        setDialogOpen(false);
    };

    return (
        <Dialog open={dialogOpen}
                onClose={dialogCleanUp}
                data-testid="category-close-dialog" >

            <DialogTitle>
                {"Close Category"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText>
                {`Do you want to close the ${categoryName} category?`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={closeCategory} variant="outlined">
                    Close Category
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default CategoryCloseDialog
