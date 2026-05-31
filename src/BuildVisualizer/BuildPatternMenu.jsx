import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';

const parseNonNegInt = (s, fallback) => {
    const n = parseInt(String(s).trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const parsePosInt = (s, fallback) => {
    const n = parseInt(String(s).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Single-surface "document menu" for the Build Visualizer: project picker plus
// file actions (New / Rename / Delete) collapsed into one MUI Menu. Replaces the
// prior cluster of a Select + several buttons in the toolbar. Duplicate / Import
// / Export were removed in req #2737 (unimplemented v1 stubs, not needed).
const BuildPatternMenu = ({ lib, onShowSnack }) => {
    const [menuAnchor, setMenuAnchor] = useState(null);
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [newMajor, setNewMajor] = useState('1');
    const [newMinor, setNewMinor] = useState('0');
    const [newInitialBuild, setNewInitialBuild] = useState('1');

    const showSnack = (severity, message) => onShowSnack?.(severity, message);

    const openMenu = (e) => setMenuAnchor(e.currentTarget);
    const closeMenu = () => setMenuAnchor(null);

    const selectPattern = (id) => {
        closeMenu();
        if (id !== lib.activeId) lib.selectPattern(id);
    };

    const openNew = () => {
        closeMenu();
        setNewName('');
        setNewMajor('1');
        setNewMinor('0');
        setNewInitialBuild('1');
        setNewOpen(true);
    };

    const confirmNew = async () => {
        const name = newName.trim();
        if (!name) return;
        const result = await lib.createNew(name, {
            major: parseNonNegInt(newMajor, 1),
            minor: parseNonNegInt(newMinor, 0),
            initialBuildNumber: parsePosInt(newInitialBuild, 1),
        });
        setNewOpen(false);
        if (result?.ok === false) showSnack('error', result.error || 'Create failed');
        else showSnack('success', `Created "${name}"`);
    };

    const openRename = () => {
        closeMenu();
        if (!lib.activePattern) return;
        setRenameValue(lib.activePattern.name);
        setRenameOpen(true);
    };

    const confirmRename = async () => {
        const name = renameValue.trim();
        if (!name || !lib.activePattern) return;
        const result = await lib.rename(lib.activePattern.id, name);
        setRenameOpen(false);
        if (result?.ok === false) showSnack('error', result.error || 'Rename failed');
        else showSnack('success', 'Renamed');
    };

    const openDelete = () => {
        closeMenu();
        setDeleteOpen(true);
    };

    const confirmDelete = async () => {
        if (!lib.activePattern) return;
        const result = await lib.remove(lib.activePattern.id);
        setDeleteOpen(false);
        if (result?.ok) showSnack('success', 'Deleted');
        else showSnack('error', result?.error || 'Delete failed');
    };

    const triggerLabel = lib.activePattern ? lib.activePattern.name : 'No project';
    const actionsDisabled = !lib.activePattern;

    return (
        <Box>
            <Button
                onClick={openMenu}
                variant="text"
                size="small"
                color="inherit"
                startIcon={<InsertDriveFileOutlinedIcon fontSize="small" />}
                endIcon={<ArrowDropDownIcon />}
                aria-haspopup="true"
                aria-expanded={Boolean(menuAnchor) ? 'true' : undefined}
                data-testid="pattern-picker"
                sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    px: 1.25,
                    minHeight: 36,
                    maxWidth: 360,
                    '& .MuiButton-startIcon': { mr: 0.75 },
                    '& .MuiButton-endIcon': { ml: 0.25 },
                }}
            >
                <Box
                    component="span"
                    sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                        maxWidth: 280,
                    }}
                >
                    {triggerLabel}
                </Box>
            </Button>

            <Menu
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={closeMenu}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { sx: { minWidth: 280, maxWidth: 360 } } }}
            >
                <ListSubheader
                    disableSticky
                    sx={{
                        bgcolor: 'transparent',
                        lineHeight: 1.5,
                        py: 0.5,
                        fontSize: '0.7rem',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                    }}
                >
                    Projects
                </ListSubheader>
                {lib.patterns.map(p => {
                    const isActive = p.id === lib.activeId;
                    return (
                        <MenuItem
                            key={p.id}
                            selected={isActive}
                            onClick={() => selectPattern(p.id)}
                            data-testid={`pattern-option-${p.id}`}
                        >
                            <ListItemIcon>
                                {isActive
                                    ? <CheckIcon fontSize="small" />
                                    : <DescriptionIcon fontSize="small" sx={{ opacity: 0.55 }} />}
                            </ListItemIcon>
                            <ListItemText
                                primary={p.name}
                                primaryTypographyProps={{
                                    noWrap: true,
                                    sx: isActive ? { fontWeight: 600 } : undefined,
                                }}
                            />
                        </MenuItem>
                    );
                })}

                <Divider />

                <MenuItem onClick={openNew} data-testid="bv-new">
                    <ListItemIcon><DescriptionIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="New Project…" />
                </MenuItem>
                <MenuItem
                    onClick={openRename}
                    disabled={actionsDisabled}
                    data-testid="bv-rename"
                >
                    <ListItemIcon><DriveFileRenameOutlineIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Rename…" />
                </MenuItem>
                <MenuItem
                    onClick={openDelete}
                    disabled={actionsDisabled}
                    data-testid="bv-delete"
                    sx={{ color: actionsDisabled ? undefined : 'error.main' }}
                >
                    <ListItemIcon>
                        <DeleteOutlineIcon
                            fontSize="small"
                            sx={{ color: actionsDisabled ? undefined : 'error.main' }}
                        />
                    </ListItemIcon>
                    <ListItemText primary="Delete" />
                </MenuItem>
            </Menu>

            <Dialog open={newOpen} onClose={() => setNewOpen(false)}>
                <DialogTitle>New Project</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 1 }}>
                        Creates a fresh project with one main branch and its first build.
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        label="Project name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) confirmNew(); }}
                        inputProps={{ 'data-testid': 'bv-new-name' }}
                    />
                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <TextField
                            label="Major"
                            type="number"
                            margin="dense"
                            value={newMajor}
                            onChange={(e) => setNewMajor(e.target.value)}
                            inputProps={{ min: 0, step: 1, 'data-testid': 'bv-new-major' }}
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            label="Minor"
                            type="number"
                            margin="dense"
                            value={newMinor}
                            onChange={(e) => setNewMinor(e.target.value)}
                            inputProps={{ min: 0, step: 1, 'data-testid': 'bv-new-minor' }}
                            sx={{ flex: 1 }}
                        />
                        <TextField
                            label="First Build #"
                            type="number"
                            margin="dense"
                            value={newInitialBuild}
                            onChange={(e) => setNewInitialBuild(e.target.value)}
                            inputProps={{ min: 1, step: 1, 'data-testid': 'bv-new-initial-build' }}
                            sx={{ flex: 1 }}
                            helperText="Defaults to 1"
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setNewOpen(false)}>Cancel</Button>
                    <Button
                        onClick={confirmNew}
                        disabled={!newName.trim()}
                        data-testid="bv-new-confirm"
                    >
                        Create
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={renameOpen} onClose={() => setRenameOpen(false)}>
                <DialogTitle>Rename project</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        label="Project name"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && renameValue.trim()) confirmRename(); }}
                        inputProps={{ 'data-testid': 'bv-rename-input' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenameOpen(false)}>Cancel</Button>
                    <Button onClick={confirmRename} disabled={!renameValue.trim()} data-testid="bv-rename-confirm">
                        Rename
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
                <DialogTitle>Delete project?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Delete "{lib.activePattern?.name}"? This cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
                    <Button onClick={confirmDelete} color="error" data-testid="bv-delete-confirm">
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default BuildPatternMenu;
