import Snackbar from '@mui/material/Snackbar';
import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import Slide from '@mui/material/Slide';


// function must remain outside component declaration
// or SnackBar won't slide down lol
function SlideTransition(props) {
    return <Slide {...props} direction="up" />;
}

const SnackBar = ({ snackBarOpen, setSnackBarOpen, snackBarMessage }) => {

    const snackBarClose = (event, reason) => {
        // allow snackbar to auto close or user clicks the X
        if (reason === 'clickaway') {
          return;
        }
        setSnackBarOpen(false);
    };

    const action = (
        <IconButton size="small"
                    color="inherit"
                    onClick={snackBarClose} >
            <CloseIcon fontSize="small" />
        </IconButton>
    );

  return (
      <Snackbar
        open={snackBarOpen}
        autoHideDuration={2000}
        onClose={snackBarClose}
        message={snackBarMessage}
        action={action}
        anchorOrigin={{
            vertical: "bottom",
            horizontal: "left"
          }}
        TransitionComponent={SlideTransition}
      />
  );
}

export default SnackBar;
