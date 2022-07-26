import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import varDump from '../classifier/classifier';
import { Typography } from '@mui/material';

const AddDomainDialog = ({ addDomainDialogOpen, setAddDomainDialogOpen, newDomainInfo, setNewDomainInfo, setAddDomainConfirmed, setDomainCloseConfirmed }) => {

    const dialogCleanUp = () => {
        console.log('dialogCleanUp');
        // Cancel and Close Path: close dialog and remove dialog state
        setAddDomainDialogOpen(false);
        setNewDomainInfo('');
        return;
    };

    const CreateDomain = (event) => {
        console.log('createDomain');
        // User confirms add new dialog. Close dialog and trigger useEffect to update DB
        setAddDomainDialogOpen(false);
        setAddDomainConfirmed(true);
    };

    const domainKeyDown = (event) => {
        console.log('keydown called');
         if (event.key === 'Enter') {
             // pressig enter key = accept the change
             setAddDomainConfirmed(true);
             setAddDomainDialogOpen(false);
             event.preventDefault(); //omit this and dialog doesn't close
         }
     }

    return (

        <Dialog open={addDomainDialogOpen}
                onClose={dialogCleanUp} >

            <DialogTitle id="domain-settings-title">
                {"Domain Settings"}
            </DialogTitle>
            <DialogContent>
                <TextField label = 'Doman Name'
                            value={newDomainInfo || ''}
                            name='domainName-name'
                            id='domainName-id'
                            variant="outlined"
                            onKeyDown = { (event) => domainKeyDown(event)}
                            onChange= { ({target}) => setNewDomainInfo(target.value) }
                            autoComplete='off'
                            size = 'small'
                            autoFocus
                            sx={{marginTop: 2 }} 
                            key={`domainname-key`}
                />
                <Typography variant='body1'
                            sx={{ marginTop: 2 }}>
                    Add a new domain to the planning sheet.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={CreateDomain} variant="outlined">
                    OK
                </Button>
                <Button onClick={dialogCleanUp} variant="outlined">
                    Cancel
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default AddDomainDialog
