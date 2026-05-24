import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

const today = () => new Date().toISOString().slice(0, 10);

const BuildPatternToolbar = ({ lib }) => {
    const fileInputRef = useRef(null);
    const [saveAsOpen, setSaveAsOpen] = useState(false);
    const [saveAsName, setSaveAsName] = useState('');
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [newOpen, setNewOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [newMajor, setNewMajor] = useState('1');
    const [newMinor, setNewMinor] = useState('0');
    const [newInitialBuild, setNewInitialBuild] = useState('1');
    const [snack, setSnack] = useState(null); // { severity, message }

    const showSnack = (severity, message) => setSnack({ severity, message });

    const closeSnack = () => setSnack(null);

    const handlePatternSelect = (event) => {
        lib.selectPattern(event.target.value);
    };

    const openNew = () => {
        setNewName('');
        setNewMajor('1');
        setNewMinor('0');
        setNewInitialBuild('1');
        setNewOpen(true);
    };

    const parseNonNegInt = (s, fallback) => {
        const n = parseInt(String(s).trim(), 10);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const parsePosInt = (s, fallback) => {
        const n = parseInt(String(s).trim(), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    const confirmNew = () => {
        const name = newName.trim();
        if (!name) return;
        const major = parseNonNegInt(newMajor, 1);
        const minor = parseNonNegInt(newMinor, 0);
        const initialBuildNumber = parsePosInt(newInitialBuild, 1);
        lib.createNew(name, { major, minor, initialBuildNumber });
        setNewOpen(false);
        showSnack('success', `Created "${name}"`);
    };

    const openSaveAs = () => {
        setSaveAsName(lib.activePattern ? `${lib.activePattern.name} copy` : '');
        setSaveAsOpen(true);
    };

    const confirmSaveAs = () => {
        const name = saveAsName.trim();
        if (!name) return;
        lib.saveAs(name);
        setSaveAsOpen(false);
        showSnack('success', `Saved as "${name}"`);
    };

    const openRename = () => {
        if (!lib.activePattern) return;
        setRenameValue(lib.activePattern.name);
        setRenameOpen(true);
    };

    const confirmRename = () => {
        const name = renameValue.trim();
        if (!name || !lib.activePattern) return;
        lib.rename(lib.activePattern.id, name);
        setRenameOpen(false);
        showSnack('success', 'Renamed');
    };

    const openDelete = () => setDeleteOpen(true);

    const confirmDelete = () => {
        if (!lib.activePattern) return;
        const result = lib.remove(lib.activePattern.id);
        setDeleteOpen(false);
        if (result.ok) showSnack('success', 'Deleted');
        else showSnack('error', result.error);
    };

    const handleExport = () => {
        const blob = lib.exportAll();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `darwin-build-patterns-${today()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSnack('success', 'Exported');
    };

    const handleImportClick = () => fileInputRef.current?.click();

    const handleImportChange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const result = await lib.importAll(file);
        if (result.ok) showSnack('success', 'Imported');
        else showSnack('error', result.error);
    };

    const deleteDisabled = lib.patterns.length <= 1 || !lib.activePattern;

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                flexWrap: 'wrap',
            }}
        >
            <FormControl size="small" sx={{ minWidth: 240 }}>
                <InputLabel id="bv-pattern-label">Pattern</InputLabel>
                <Select
                    labelId="bv-pattern-label"
                    label="Pattern"
                    value={lib.activeId || ''}
                    onChange={handlePatternSelect}
                    inputProps={{ 'data-testid': 'pattern-picker' }}
                >
                    {lib.patterns.map(p => (
                        <MenuItem key={p.id} value={p.id} data-testid={`pattern-option-${p.id}`}>
                            {p.name}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <Button size="small" variant="outlined" onClick={openNew} data-testid="bv-new">
                New
            </Button>
            <Button size="small" onClick={openSaveAs} disabled={!lib.activePattern} data-testid="bv-save-as">
                Save As
            </Button>
            <Button size="small" onClick={openRename} disabled={!lib.activePattern} data-testid="bv-rename">
                Rename
            </Button>
            <Button
                size="small"
                color="error"
                onClick={openDelete}
                disabled={deleteDisabled}
                data-testid="bv-delete"
            >
                Delete
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={handleExport} data-testid="bv-export">Export</Button>
            <Button size="small" onClick={handleImportClick} data-testid="bv-import">Import</Button>
            <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportChange}
                style={{ display: 'none' }}
                data-testid="bv-import-input"
            />

            <Dialog open={newOpen} onClose={() => setNewOpen(false)}>
                <DialogTitle>New build doc</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 1 }}>
                        Creates a fresh build pattern with one main branch and its first build.
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

            <Dialog open={saveAsOpen} onClose={() => setSaveAsOpen(false)}>
                <DialogTitle>Save pattern as</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        label="Pattern name"
                        value={saveAsName}
                        onChange={(e) => setSaveAsName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && saveAsName.trim()) confirmSaveAs(); }}
                        inputProps={{ 'data-testid': 'bv-save-as-input' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSaveAsOpen(false)}>Cancel</Button>
                    <Button onClick={confirmSaveAs} disabled={!saveAsName.trim()} data-testid="bv-save-as-confirm">
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={renameOpen} onClose={() => setRenameOpen(false)}>
                <DialogTitle>Rename pattern</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        label="Pattern name"
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
                <DialogTitle>Delete pattern?</DialogTitle>
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

            <Snackbar
                open={!!snack}
                autoHideDuration={1800}
                onClose={closeSnack}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                {snack ? (
                    <Alert severity={snack.severity} onClose={closeSnack} variant="filled">
                        {snack.message}
                    </Alert>
                ) : undefined}
            </Snackbar>
        </Box>
    );
};

export default BuildPatternToolbar;
