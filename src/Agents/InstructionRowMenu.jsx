// The per-row options menu for an instruction (req #3067).
//
// Extracted from the card so the CARD and the TABLE cannot drift: both views offer
// the same three actions, with the same graduated-close semantics and the same
// data-testids, because they render the same component. A second copy under a
// `renderCell` would have been the easy path and the wrong one — the ellipsis on
// "Close instruction…" is a real behavioural affordance (it is how the user tells
// the dialog path from the immediate one), and two copies is how one of them
// silently loses it.
//
// This is a RENDERER, not a decision-maker. Every handler belongs to the page,
// which owns the write queue, the dialog state and the blast-radius gate.
//
// IT OWNS ITS OWN ANCHOR, and that is a correctness property rather than tidiness.
// The page used to hold `{ id, el }` for whichever row's menu was open. Nothing
// cleared that when a ROW went away on its own — and in the table a row can vanish
// with no user gesture at all (a background refetch reshuffling a page boundary,
// or the rightmost column scrolling out of the virtualization context). The menu
// then remounted with `open` still true against a DETACHED anchor element, which
// MUI renders at the viewport origin. Anchor state that lives inside the row cannot
// outlive the row.
//
// It also kept `columns` from memoizing in the table: a page-level anchor is a new
// value on every menu open, so the column definitions were rebuilt each time — see
// the ref note in InstructionsTableView.

import { useState } from 'react';

import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import CloseIcon from '@mui/icons-material/Close';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import UnarchiveIcon from '@mui/icons-material/Unarchive';

const InstructionRowMenu = ({
    row,
    onCloseInstruction,
    onReopen,
    onDelete,
}) => {
    const [anchorEl, setAnchorEl] = useState(null);
    const close = () => setAnchorEl(null);

    // Dismiss FIRST, then act. The handlers open dialogs, and a menu still on
    // screen behind a dialog is the artefact this ordering avoids. It also means
    // the page's handlers no longer have to know a menu exists.
    const pick = (handler) => () => { close(); handler(row); };

    return (
        <>
            <Tooltip title="Instruction options">
                <IconButton
                    size="small"
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                    sx={{ maxWidth: '25px', maxHeight: '25px' }}
                    data-testid={`instruction-card-menu-${row.id}`}
                >
                    <MoreVertIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={anchorEl}
                open={!!anchorEl}
                onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ list: { 'data-testid': `instruction-card-menu-popup-${row.id}` } }}
            >
                {row.closed ? (
                    <MenuItem onClick={pick(onReopen)}
                              data-testid={`instruction-menu-reopen-${row.id}`}>
                        <ListItemIcon><UnarchiveIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Reopen instruction</ListItemText>
                    </MenuItem>
                ) : (
                    <MenuItem onClick={pick(onCloseInstruction)}
                              data-testid={`instruction-menu-close-${row.id}`}>
                        <ListItemIcon><CloseIcon fontSize="small" /></ListItemIcon>
                        {/* Ellipsis = opens the dialog, because this row is bound and
                            the agents it would unload from must be shown. No ellipsis =
                            closes immediately. Read from the LIVE row, never a
                            snapshot: a refetch can land while the menu is open. */}
                        <ListItemText>
                            {row.refs.length === 0
                                ? 'Close instruction'
                                : 'Close instruction…'}
                        </ListItemText>
                    </MenuItem>
                )}
                <Divider />
                <MenuItem onClick={pick(onDelete)}
                          sx={{ color: 'error.main' }}
                          data-testid={`instruction-menu-delete-${row.id}`}>
                    <ListItemIcon>
                        <DeleteForeverIcon fontSize="small" sx={{ color: 'error.main' }} />
                    </ListItemIcon>
                    <ListItemText>Delete permanently…</ListItemText>
                </MenuItem>
            </Menu>
        </>
    );
};

export default InstructionRowMenu;
