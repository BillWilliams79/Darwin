import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const DomainDeleteDialog = ({ domainDeleteDialogOpen, setDomainDeleteDialogOpen, domainInfo, setDomainInfo, setDomainDeleteConfirmed }) => {

    const {domainName, domainId, tasksCount } = domainInfo;
    
    let taskString = ` and its ${tasksCount} related tasks?`;

    if (tasksCount === undefined) {
        taskString = '?';
    } else if (tasksCount === 1) {
        taskString = ' and its 1 related task?'
    }
    
    const dialogCleanUp = () => {
        // Cancel and Close Path
        setDomainDeleteDialogOpen(false);
        setDomainInfo({});
        return;
    };

    const clickDeleteDomain = (event) => {
        // User confirms delete
        setDomainDeleteConfirmed(true);
        setDomainDeleteDialogOpen(false);
    };

    return (

        <Dialog open={domainDeleteDialogOpen}
                onClose={dialogCleanUp} >

            <DialogTitle id="confirm-delete-title">
                {"Delete Domain?"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="confirm-delete-text">
                {`Permanently delete the domain ${domainName}${taskString}`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={clickDeleteDomain} variant="outlined">
                    Delete
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default DomainDeleteDialog
