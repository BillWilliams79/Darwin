// req #2877 — Merge Rules reference popup.
//
// A read-only grid documenting the Build Visualizer's merge scheme for EVERY
// branch type that has merge rules. Under the new model every change rides a dev
// branch: the "Merges From" column says whether a type merges via the NAMED
// branch itself (the dev-scheme branches — Development plus the Hot Fix / Bootleg
// exceptions) or via a dev branch taken off it (Release, Sprint/Sample, CSR).
// The grid is derived straight from MERGE_RULES via `mergeRulesGridRows()` so it
// can never drift from the engine.
//
// Each rule is tagged MANDATORY (required merge, solid arrow in the diagram) or
// EVALUATE (consider before merging, dashed arrow). The chip colors mirror the
// diagram: both kinds use the same blue, distinguished filled vs outlined the
// same way the arrows are solid vs dashed.

import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { mergeRulesGridRows, MERGE_REQUIRED } from './mergeEngine';
import { branchTypeLabel, branchTypeChipProps } from './branchTypeChipStyles';

// Blue used for both merge-arrow kinds in the diagram (d3ThemePalettes `merge`).
const MERGE_BLUE = '#2563eb';

const kindChipSx = (kind) =>
    kind === MERGE_REQUIRED
        ? { bgcolor: MERGE_BLUE, color: '#fff', fontWeight: 600 }
        : { color: MERGE_BLUE, borderColor: MERGE_BLUE, borderStyle: 'dashed' };

const MergeRulesDialog = ({ open, onClose }) => {
    const rows = mergeRulesGridRows();
    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            data-testid="bv-merge-rules-dialog"
        >
            <DialogTitle>Merge Rules</DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Every change rides a dev branch. <strong>Merges From</strong> shows whether a
                    branch type merges via the named branch itself (the dev branches — Development,
                    Hot Fix, Bootleg) or via a dev branch taken off it. <strong>Mandatory</strong>{' '}
                    merges are required (solid arrow); <strong>Evaluate</strong> merges require
                    consideration before merging (dashed arrow).
                </Typography>
                <Table size="small" data-testid="bv-merge-rules-grid">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 700 }}>Branch</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Merges From</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Merge destination</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Requirement</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(row => (
                            row.rules.map((rule, i) => (
                                <TableRow
                                    key={`${row.type}-${i}`}
                                    data-testid={`bv-merge-rule-${row.type}`}
                                >
                                    {i === 0 && (
                                        <TableCell
                                            rowSpan={row.rules.length}
                                            sx={{ verticalAlign: 'top' }}
                                        >
                                            <Chip
                                                size="small"
                                                label={branchTypeLabel(row.type)}
                                                {...branchTypeChipProps(row.type)}
                                            />
                                        </TableCell>
                                    )}
                                    {i === 0 && (
                                        <TableCell
                                            rowSpan={row.rules.length}
                                            sx={{ verticalAlign: 'top' }}
                                        >
                                            {row.mergesFrom}
                                        </TableCell>
                                    )}
                                    <TableCell>{rule.dest}</TableCell>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            label={rule.kindLabel}
                                            variant={rule.kind === MERGE_REQUIRED ? 'filled' : 'outlined'}
                                            sx={kindChipSx(rule.kind)}
                                            data-testid={`bv-merge-kind-${rule.kind}`}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))
                        ))}
                    </TableBody>
                </Table>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} data-testid="bv-merge-rules-close">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default MergeRulesDialog;
