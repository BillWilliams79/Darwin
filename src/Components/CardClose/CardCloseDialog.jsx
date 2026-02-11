import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';


const CardCloseDialog = ({cardSettingsDialogOpen,
                          setCardSettingsDialogOpen,
                          areaCloseId,
                          setAreaCloseId,
                          setAreaCloseConfirmed }
                        ) => {

    const { areaName } = areaCloseId;

    const dialogCleanUp = () => {
        // Cancel and Close Path
        setCardSettingsDialogOpen(false);
        setAreaCloseId({});
        return;
    };

    const closeArea = (event) => {
        // User confirms card closure
        setAreaCloseConfirmed(true);
        setCardSettingsDialogOpen(false);
    };

    return (

        <Dialog open={cardSettingsDialogOpen}
                onClose={dialogCleanUp}
                data-testid="card-close-dialog" >

            <DialogTitle id="card-settings-title">
                {"Card Settings"}
            </DialogTitle>
            <DialogContent>
                <DialogContentText id="card-settings-text">
                {`Do you want to close the ${areaName} card?`}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={closeArea} variant="outlined">
                    Close Card
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined" autoFocus>
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default CardCloseDialog
