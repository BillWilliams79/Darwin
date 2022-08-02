import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const DomainSettingsDialog = ({ tabSettingsDialogOpen, setTabSettingsDialogOpen, domainCloseId, setDomainCloseId, setDomainCloseConfirmed }) => {

    const { domainName } = domainCloseId;

    const dialogCleanUp = () => {
        // Cancel and Close Path
        setTabSettingsDialogOpen(false);
        setDomainCloseId({});
        return;
    };

    const closeDomain = (event) => {
        // User confirms card closure
        setDomainCloseConfirmed(true);
        setTabSettingsDialogOpen(false);
    };

    return (

        <Dialog open={tabSettingsDialogOpen}
                onClose={dialogCleanUp} >

            <DialogTitle id="tab-settings-title">
                {"Tab Settings"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="tab-settings-text">
                {`Do you want to close the ${domainName} tab?`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={closeDomain} variant="outlined">
                    Close Tab
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default DomainSettingsDialog
