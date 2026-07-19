// eslint-disable-next-line no-unused-vars
import varDump from '../../classifier/classifier';

import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';

const DomainCloseDialog = ({ domainCloseDialogOpen, 
                             setDomainCloseDialogOpen,
                             domainCloseId,
                             setDomainCloseId,
                             setDomainCloseConfirmed }
                          ) => {

    // Dialog to handle closing a domain from a tab
    const { domainName } = domainCloseId;

    const dialogCleanUp = () => {
        // Cancel and Close Path
        setDomainCloseDialogOpen(false);
        setDomainCloseId({});
        return;
    };

    const closeDomain = (event) => {
        // User confirms card closure
        setDomainCloseConfirmed(true);
        setDomainCloseDialogOpen(false);
    };

    return (

        <Dialog open={domainCloseDialogOpen}
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

export default DomainCloseDialog
