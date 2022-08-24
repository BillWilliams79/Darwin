import varDump from '../../classifier/classifier';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { Typography } from '@mui/material';

const DomainAddDialog = ({ domainAddDialogOpen,
                           setDomainAddDialogOpen,
                           newDomainInfo,
                           setNewDomainInfo,
                           setDomainAddConfirmed, }
                        ) => {

    const dialogCleanUp = () => {
        // Cancel and Close Path: close dialog and remove dialog state
        setDomainAddDialogOpen(false);
        setNewDomainInfo('');
        return;
    };

    const CreateDomain = (event) => {
        // User confirms add new dialog. Close dialog and trigger useEffect to update DB
        processCreateDomain(event);
    };

    const domainKeyDown = (event) => {

         if (event.key === 'Enter') {
            // pressing enter key = create the event
            processCreateDomain(event);
         }
     }

     const processCreateDomain = (event) => {
        // new domain created for non-blank values only
        if (newDomainInfo !== '') {
            setDomainAddConfirmed(true);
            setDomainAddDialogOpen(false);
            event.preventDefault(); //omit this and dialog doesn't close
        }
     }

    return (

        <Dialog open={domainAddDialogOpen}
                onClose={dialogCleanUp} >

            <DialogTitle id="domain-settings-title">
                {"Create New Domain"}
            </DialogTitle>
            <DialogContent>
                <TextField label = 'Doman Name'
                            value={newDomainInfo || ''}
                            name='domainName-name'
                            id='domainName-id'
                            variant="outlined"
                            onKeyDown = { event => domainKeyDown(event)}
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

export default DomainAddDialog
