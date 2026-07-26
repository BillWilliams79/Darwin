// /agents/context — Agentic Telemetry (req #3031, renamed + polished req #3065).
//
// Renders the published visual-acceptance artifact
// (660a8b6b-b215-4b7a-b5a4-91c31e82460d) from stored telemetry: the multi-row
// grouped header [Boot time | FIXED OVERHEAD: Claude Code / CLAUDE.md / Agent
// File | Loaded per-agent: Agent MCP Payload / Architecture Docs / Docs Loaded |
// Agent Init Context], zebra rows, a sticky Agent column, and the teal Agent-
// Init-Context emphasis. Column labels are display-only relabels (req #3065)
// of the underlying field names, which are unchanged — see `SORT_COLUMNS` in
// contextRenderUtils.js for the field <-> label mapping. The capture picker
// is the first element of the render window, above the Description box,
// which is above the table (req #3065) — separate from the header row above
// it (view toggle / title / glossary), which is width-capped to align with
// the table's right edge. Variable agent counts render as-is (nothing
// assumes a fixed roster). The glossary lives behind a header button rather
// than inline — it is reference material, not part of the artifact
// reproduction, so it does not need the bespoke CSS. Rename and Delete for
// the active capture live inside the picker's own Menu (req #3065 follow-up),
// mirroring BuildVisualizer's BuildPatternMenu — list with a checkmark on the
// active row, a Divider, then Rename… / Delete. No "New…" row: captures are
// produced only by the telemetry-capture skill, never from this page.
//
// The 9 leaf column headers are click-to-sort: one field is active at a
// time, defaulting to Agent name ascending. Clicking the active column flips
// its direction; clicking a different one replaces it, starting at that
// column's natural direction — descending for numeric columns (largest
// first), ascending for the one string column. See `sortByColumn` /
// `naturalSortDir` in contextRenderUtils.js.
//
// All values are ACTUAL tokens (real tokenizer via transcript usage deltas),
// except Boot time (ms). Columns are NULL where a phase does not apply
// (PrimaryAI has no boot/autoload; the Code Reviewer bundles its charter stub
// into Claude Code) — those cells render "n/a" or a footnote marker, matching
// the artifact. The Docs cell renders in red when one or more architecture
// documents failed to load for that agent.
//
// Docs Loaded drill-down (req #3096): when at least one document was loaded,
// the cell is click-to-expand — a chevron toggles an inline detail <tr> right
// below the agent's row, listing that run's per-document actual-token
// breakdown (AgentDocsDetail). Deliberately NOT an MUI DataGrid (this page
// already bypasses that convention to reproduce the artifact byte-for-byte,
// see above) — the detail row reuses the same hand-rolled table CSS system
// instead. Data is fetched lazily, only once a row is actually expanded
// (useAgentTelemetryRowDocsByRow), never eagerly for every row on page load.

import '../index.css';
import { Fragment, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import CheckIcon from '@mui/icons-material/Check';
import DescriptionIcon from '@mui/icons-material/Description';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import TableChartIcon from '@mui/icons-material/TableChart';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import AppContext from '../Context/AppContext';
import AuthContext from '../Context/AuthContext';
import GhostTextField from '../Components/GhostField/GhostTextField';
import { formatDateTime } from '../utils/dateFormat';
import {
    useAgentTelemetryRuns, useAgentTelemetryRowsByRun, useAgentTelemetryRowDocsByRow,
    agentTelemetryRunKeys, useMachines,
} from '../hooks/useDataQueries';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useSnackBarStore } from '../stores/useSnackBarStore';
import { deleteAgentTelemetryRun, updateAgentTelemetryRun } from './actions/contextApi';
import { aiModelChipProps, aiModelLabel } from '../SwarmView/modelChipStyles';
import { effortChipProps, effortLabel } from '../SwarmView/effortChipStyles';
import {
    NA as NA_TEXT, fmt, sortByColumn, naturalSortDir, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR,
    assignMarkers, computeCells, runDateLabel,
} from './contextRenderUtils';
import ContextDeleteDialog from './ContextDeleteDialog';

// The fixed glossary entries — one per numeric/n/a column header below (req
// #3065 relabel keeps these terms in sync), plus "Units" (a global note, not
// tied to one column) and "Boot time" (its own column but not a token count).
// "Agent" has no entry — it's a name, self-explanatory. The per-row footnote
// definitions (*, †, …) are appended dynamically per run.
const GLOSSARY = [
    ['Units', <>All values are <strong>actual tokens</strong> (real tokenizer, from transcript usage deltas), except <strong>Boot time</strong> which is milliseconds.</>],
    ['Boot time', <>Latency of the <code>darwin://agents/&lt;Name&gt;</code> boot call, measured <strong>sequentially</strong> (one boot at a time; parallel launch inflates it ~2&times;).</>],
    ['Claude Code', <>The Claude Code system prompt: harness instructions + tool schemas + skills listing + MCP listing. Equals Initial context minus CLAUDE.md and the charter stub.</>],
    ['CLAUDE.md', <>The project instruction file, loaded into every session.</>],
    ['Agent File', <>The agent's <code>.claude/agents/*.md</code> file, loaded as its system prompt.</>],
    ['Agent MCP Payload', <>Context added by the boot call — identity row, binding instructions, and document pointers (not document contents).</>],
    ['Architecture Docs', <>Context added by reading the agent's autoload architecture documents in full.</>],
    ['Docs Loaded', <>Autoload documents loaded / expected. Red when one or more failed to load.</>],
    ['Agent Init Context', <>Total context once loaded and ready to work — the <code>/context</code> figure.</>],
];

function cssVars(mode) {
    // The artifact's two palettes, keyed off the MUI theme mode so the page
    // tracks Darwin's light/dark toggle (not prefers-color-scheme).
    return mode === 'dark'
        ? {
            '--panel': '#151a22', '--ink': '#e7ebf1', '--muted': '#8b94a3',
            '--line': '#232b36', '--line-strong': '#333d4b', '--head': '#1a212b',
            '--accent': '#2dd4bf', '--accent-soft': '#2dd4bf1f', '--zebra': '#121821',
            '--danger': '#ef5350',
        }
        : {
            '--panel': '#ffffff', '--ink': '#171c26', '--muted': '#5c6675',
            '--line': '#e3e8ee', '--line-strong': '#cdd5df', '--head': '#eef2f6',
            '--accent': '#0f766e', '--accent-soft': '#0f766e14', '--zebra': '#fafbfc',
            '--danger': '#c62828',
        };
}

// Scoped CSS — every selector under .atc-root so nothing leaks into the app.
const TABLE_CSS = `
.atc-root { --mono: ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
.atc-scroll { overflow-x:auto; border:1px solid var(--line); border-radius:12px; background:var(--panel); }
.atc-root table { border-collapse:collapse; width:100%; font-size:13.5px; }
.atc-root thead th { background:var(--head); color:var(--ink); font-weight:600; padding:9px 13px; border-bottom:1px solid var(--line-strong); white-space:nowrap; }
.atc-root th.sortable { cursor:pointer; user-select:none; }
.atc-root th.sortable:hover { background:var(--accent-soft); }
.atc-root thead tr:first-of-type th { font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--line); }
.atc-root .grp { text-align:center; border-left:1px solid var(--line); border-right:1px solid var(--line); }
.atc-root th.num, .atc-root td.num { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }
.atc-root th.mid, .atc-root td.mid { text-align:center; }
.atc-root th.agent, .atc-root td.agent { text-align:left; position:sticky; left:0; background:var(--panel); font-weight:600; white-space:nowrap; box-shadow:1px 0 0 var(--line); }
.atc-root thead th.agent { background:var(--head); }
.atc-root tbody td { padding:8px 13px; border-bottom:1px solid var(--line); color:var(--ink); }
.atc-root tbody tr.even-row td { background:var(--zebra); }
.atc-root tbody tr.even-row td.agent { background:var(--zebra); }
.atc-root tbody tr:hover td, .atc-root tbody tr:hover td.agent { background:var(--accent-soft); }
.atc-root .swc { font-weight:700; color:var(--accent); }
.atc-root tr.primary td.agent { color:var(--accent); }
.atc-root .fn { color:var(--muted); font-family:inherit; }
.atc-root .docs-warn { color:var(--danger); font-weight:700; }
.atc-root td.docs-clickable { cursor:pointer; text-decoration:underline dotted; text-underline-offset:3px; }
.atc-root td.docs-clickable:hover { color:var(--accent); }
.atc-root tr.doc-detail td { background:var(--zebra); padding:4px 13px 12px 13px; }
.atc-root .doc-detail-table { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:2px; }
.atc-root .doc-detail-table td { padding:3px 10px; border:none; color:var(--muted); }
.atc-root .doc-detail-table td.doc-path { font-family:var(--mono); color:var(--ink); }
.atc-root .doc-detail-table td.doc-tokens { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; color:var(--ink); }
`;

// req #3096 — the per-document breakdown for one agent row's Docs Loaded cell.
// Only ever mounted while its row is expanded (see `expandedDocRows` below), so
// the fetch is lazy by construction — no `enabled` gate needed, the query simply
// does not exist in the tree until the user asks for it.
const AgentDocsDetail = ({ rowId }) => {
    const { data: docs, isLoading } = useAgentTelemetryRowDocsByRow(rowId);
    const sorted = useMemo(() => {
        return [...(docs || [])].sort((a, b) => {
            const as = a.sort_order ?? Number.MAX_SAFE_INTEGER;
            const bs = b.sort_order ?? Number.MAX_SAFE_INTEGER;
            return (as - bs) || (a.id - b.id);
        });
    }, [docs]);
    return (
        <tr className="doc-detail" data-testid={`agent-context-docs-detail-${rowId}`}>
            <td className="agent" />
            <td colSpan={8}>
                {isLoading ? (
                    <CircularProgress size={14} />
                ) : sorted.length === 0 ? (
                    <span className="fn">No per-document breakdown captured for this run.</span>
                ) : (
                    <table className="doc-detail-table" data-testid={`agent-context-docs-grid-${rowId}`}>
                        <tbody>
                            {sorted.map((d) => (
                                <tr key={d.id} data-testid={`agent-context-docs-detail-item-${rowId}-${d.id}`}>
                                    <td className="doc-path">{d.doc_path}</td>
                                    <td className="doc-tokens">{fmt(d.actual_tokens)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </td>
        </tr>
    );
};

const ContextPage = () => {
    const { profile, idToken } = useContext(AuthContext);
    const { darwinUri } = useContext(AppContext);
    const theme = useTheme();
    const isMobile = useMediaQuery('(max-width:899px)');
    const creatorFk = profile?.userName;
    const queryClient = useQueryClient();
    const showError = useSnackBarStore(s => s.showError);

    const { data: runs, isLoading: runsLoading } = useAgentTelemetryRuns(creatorFk);
    // req #3098 — resolve a run's machine_fk to a friendly name, same pattern
    // as SwarmSessionDetail.jsx.
    const { data: machinesData = [] } = useMachines(creatorFk);

    // Runs arrive newest-first (captured_at:desc); default to the newest capture.
    const [selectedId, setSelectedId] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [savingNote, setSavingNote] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameTargetId, setRenameTargetId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [renaming, setRenaming] = useState(false);
    const [glossaryOpen, setGlossaryOpen] = useState(false);
    const [captureAnchor, setCaptureAnchor] = useState(null);
    const [sortField, setSortField] = useState(DEFAULT_SORT_FIELD);
    const [sortDir, setSortDir] = useState(DEFAULT_SORT_DIR);
    // req #3096 — which agent rows currently show their per-document breakdown.
    // Multiple rows may be expanded at once (comparing agents is a natural use).
    const [expandedDocRows, setExpandedDocRows] = useState(() => new Set());
    const toggleDocsExpanded = (rowId) => setExpandedDocRows((prev) => {
        const next = new Set(prev);
        if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
        return next;
    });
    const runsSorted = useMemo(() => runs || [], [runs]);
    // Self-healing: if `selectedId` points at a run that no longer exists in
    // `runsSorted` (e.g. deleted from another tab/session — a background
    // refetch can land that change here at any time via TanStack Query's
    // refetchOnWindowFocus/staleTime), fall back to the newest capture rather
    // than resolving to nothing. Without this, `activeRun` stays permanently
    // null even though `runsSorted` is non-empty, and every unguarded read of
    // it below (this page has several) becomes a crash waiting for a stale
    // selection.
    const activeRun = useMemo(() => {
        const bySelection = selectedId != null
            ? runsSorted.find(r => r.id === selectedId) : null;
        return bySelection || runsSorted[0] || null;
    }, [runsSorted, selectedId]);
    const activeRunId = activeRun?.id ?? null;
    // req #3098 — machine_fk -> friendly name; NULL for pre-#3098 captures and
    // any capture whose machine resolution failed at store time.
    const machineName = useMemo(() => {
        if (!activeRun || activeRun.machine_fk == null) return null;
        const m = machinesData.find(x => x.id === activeRun.machine_fk);
        return m ? m.title : null;
    }, [machinesData, activeRun]);

    const { data: rows, isLoading: rowsLoading } = useAgentTelemetryRowsByRun(activeRunId);

    // The Menu's own onClose doesn't fire when the LIST it's showing disappears
    // out from under it (e.g. a background refetch reflects a deletion made in
    // another tab) — only when the user clicks away or hits Escape. Without
    // this, the trigger Button goes `disabled` but the popup can stay open,
    // anchored to a button that no longer accepts clicks, showing zero rows.
    useEffect(() => {
        if (runsSorted.length === 0) setCaptureAnchor(null);
    }, [runsSorted.length]);

    const performDelete = async (run) => {
        const targetId = run.id;
        setDeleting(true);
        try {
            await deleteAgentTelemetryRun(darwinUri, idToken, targetId);
            // Only clear an explicit selection that still points at the row we just
            // deleted — if the user picked a different capture while this delete was
            // in flight, that pick must survive, not get silently overwritten.
            setSelectedId(prev => (prev === targetId ? null : prev));
            await queryClient.invalidateQueries({ queryKey: agentTelemetryRunKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Could not delete the capture');
        } finally {
            setDeleting(false);
        }
    };

    // GhostTextField's commit contract: RETHROW on failure so the field reverts
    // — it must never keep showing text the database rejected. `text` already
    // arrives trimmed (the field's `normalize` prop), so a whitespace-only
    // edit reverts to null rather than persisting as a "description" that
    // looks blank.
    //
    // Ordinary click-to-switch-capture is already safe without help from the
    // field's `key`: clicking a Menu item blurs the still-focused field FIRST
    // (standard DOM focus-change-precedes-click ordering), so this handler
    // fires and closes over the OLD activeRun.id before React ever processes
    // the click. The `key={activeRun.id}` on the field guards a narrower,
    // click-free case instead: a background refetch (refetchOnWindowFocus /
    // staleTime) swapping `activeRun` out from under a FOCUSED, DIRTY field.
    // There, remounting is what stops this handler from later firing closed
    // over the NEW run's id with the OLD run's edited text — the cost is that
    // the unsaved edit is silently discarded rather than committed to the
    // wrong record. No confirmation or warning is shown for that; there is no
    // existing "field identity changes while dirty" pattern in Darwin to
    // reuse instead, and this case is rare enough that no-write beats
    // wrong-record-write without one.
    const commitSourceNote = async (text) => {
        // Blocks the delete button for this same window (see its `disabled`
        // prop below) — an in-flight PUT racing a DELETE on the same run
        // could otherwise land after the row is gone and silently no-op
        // rather than error, with no way for this page to notice.
        setSavingNote(true);
        try {
            await updateAgentTelemetryRun(darwinUri, idToken, activeRun.id,
                { source_note: text || null });
            await queryClient.invalidateQueries({ queryKey: agentTelemetryRunKeys.all(creatorFk) });
        } catch (err) {
            showError(err, 'Could not save the description');
            throw err;
        } finally {
            setSavingNote(false);
        }
    };

    // Rename Capture — single-field dialog, same shape as BuildPatternMenu's
    // "Rename project" (BuildVisualizer/BuildPatternMenu.jsx): open seeds the
    // field from the current value, confirm trims and PUTs, Enter submits.
    //
    // `renameTargetId` snapshots which run the dialog was opened for, mirroring
    // useConfirmDialog's `infoObject` capture for Delete below. Without it,
    // confirmRename reading `activeRun.id` live would write to whatever run
    // happens to be active at CONFIRM time, not OPEN time — a background
    // refetch or a picker click while the dialog sits open could swap
    // `activeRun` out from under it and rename the wrong capture.
    const openRename = () => {
        if (!activeRun) return;
        setRenameTargetId(activeRun.id);
        setRenameValue(activeRun.label);
        setRenameOpen(true);
    };

    const confirmRename = async () => {
        const label = renameValue.trim();
        if (!label || renameTargetId == null) return;
        // Unlike commitSourceNote's `savingNote`, this doesn't need to also
        // guard the Delete button: the Rename Dialog is modal for `renaming`'s
        // entire lifetime, so Delete is already unreachable behind it.
        setRenaming(true);
        try {
            await updateAgentTelemetryRun(darwinUri, idToken, renameTargetId, { label });
            await queryClient.invalidateQueries({ queryKey: agentTelemetryRunKeys.all(creatorFk) });
            setRenameOpen(false);
        } catch (err) {
            showError(err, 'Could not rename the capture');
        } finally {
            setRenaming(false);
        }
    };

    // House confirm-dialog pattern (see ContextDeleteDialog.jsx / TaskDeleteDialog):
    // the dialog only sets `confirmed`, the effect-driven callback here performs
    // the actual write. Replaces a window.confirm, which had no mini-preview and
    // no Playwright affordance.
    const captureDelete = useConfirmDialog({
        onConfirm: (run) => { if (run?.id) performDelete(run); },
    });

    // Single active sort key at a time. Clicking the already-active column
    // flips its direction; clicking a different one replaces it, starting at
    // that column's natural direction — descending (largest first) for a
    // numeric column, ascending (A→Z) for the one string column.
    const handleSort = (field) => {
        if (sortField === field) {
            setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDir(naturalSortDir(field));
        }
    };

    const sortArrow = (field) => (sortField === field
        ? (sortDir === 'asc'
            ? <ArrowUpwardIcon sx={{ fontSize: 13, verticalAlign: 'middle', ml: '3px' }} />
            : <ArrowDownwardIcon sx={{ fontSize: 13, verticalAlign: 'middle', ml: '3px' }} />)
        : null);

    const rendered = useMemo(() => {
        const list = sortByColumn(rows, sortField, sortDir);
        return { list, markerByText: assignMarkers(list) };
    }, [rows, sortField, sortDir]);

    if (runsLoading) {
        return <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}><CircularProgress /></Box>;
    }

    const vars = cssVars(theme.palette.mode);

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }} data-testid="agent-context-page">
            <style>{TABLE_CSS}</style>

            {/* maxWidth matches the atc-root Box below so the trailing icons here
                right-align with the telemetry table's actual right edge, not the
                full (possibly much wider) page — req #3065. mb matches the
                atc-root Box's own flex `gap` (34px) so the gap above the capture
                picker equals the gap below it (picker -> Description). */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: '34px', flexWrap: 'wrap', gap: 2, maxWidth: 1120 }}>
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value="table"
                    onChange={() => {}}
                    sx={{ flexShrink: 0 }}
                    data-testid="agent-context-view-toggle"
                >
                    <Tooltip title="Table view">
                        <ToggleButton value="table" aria-label="table view" data-testid="view-toggle-table">
                            <TableChartIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                </ToggleButtonGroup>

                <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}>
                    Agentic Telemetry
                </Typography>

                <Tooltip title="Glossary — column definitions">
                    <IconButton
                        size="small"
                        onClick={() => setGlossaryOpen(true)}
                        sx={{ flexShrink: 0 }}
                        data-testid="agent-context-glossary-btn"
                    >
                        <MenuBookIcon fontSize="small" />
                    </IconButton>
                </Tooltip>

            </Box>

            {runsSorted.length === 0 ? (
                <Typography color="text.secondary" sx={{ p: 2 }} data-testid="agent-context-empty">
                    No telemetry captures recorded yet.
                </Typography>
            ) : (
                <Box className="atc-root" sx={{ ...vars, display: 'flex', flexDirection: 'column', gap: '34px', maxWidth: 1120 }}>
                    {/* Capture control is the first element of the render window
                        (req #3065) — above the Description, which is itself above
                        the table. A Button rather than a <Select> so the dropdown
                        trigger icon sits on the LEFT of the label instead of MUI's
                        default right-hand arrow; the popup Menu's MenuItems are
                        left-justified text by default.
                        Menu shape mirrors BuildVisualizer's BuildPatternMenu (req
                        #3065 follow-up): capture list with a checkmark on the
                        active row, then a Divider, then Rename… / Delete — folding
                        the two per-capture actions into this one surface instead
                        of separate header icons. No "New…" row: new captures are
                        skill-produced (agent-telemetry-run capture pipeline), never
                        created from this page. */}
                    <Box>
                        <Tooltip title="Select a capture">
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={(e) => setCaptureAnchor(e.currentTarget)}
                                startIcon={<ArrowDropDownIcon />}
                                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                                data-testid="agent-context-run-picker"
                            >
                                {activeRun ? runDateLabel(activeRun) : 'Select a capture'}
                            </Button>
                        </Tooltip>
                        <Menu
                            anchorEl={captureAnchor}
                            open={!!captureAnchor}
                            onClose={() => setCaptureAnchor(null)}
                            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                            slotProps={{ paper: { sx: { minWidth: 280, maxWidth: 360 } } }}
                            data-testid="agent-context-run-menu"
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
                                Captures
                            </ListSubheader>
                            {runsSorted.map(r => {
                                const isActive = r.id === activeRunId;
                                return (
                                    <MenuItem key={r.id} selected={isActive}
                                              onClick={() => { setSelectedId(r.id); setCaptureAnchor(null); }}
                                              data-testid={`agent-context-run-option-${r.id}`}>
                                        <ListItemIcon>
                                            {isActive
                                                ? <CheckIcon fontSize="small" />
                                                : <DescriptionIcon fontSize="small" sx={{ opacity: 0.55 }} />}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={runDateLabel(r)}
                                            primaryTypographyProps={{
                                                noWrap: true,
                                                sx: isActive ? { fontWeight: 600 } : undefined,
                                            }}
                                        />
                                    </MenuItem>
                                );
                            })}

                            <Divider />

                            {/* Blocked while a delete or a source_note save is
                                in flight — same guard the old standalone icon
                                buttons carried, moved here unchanged. Neither
                                state has a modal covering this trigger (the
                                delete-confirm Dialog closes itself the instant
                                it's confirmed, before the DELETE resolves; the
                                source_note autosave never had a dialog at all),
                                so this disabled check is still the only thing
                                stopping a rename/delete from racing an in-flight
                                write on the same run. (A THIRD in-flight state,
                                `renaming`, needs no entry here — its Dialog stays
                                modal for the PUT's entire duration, which already
                                blocks reopening this Menu at all.) */}
                            <MenuItem
                                onClick={() => { setCaptureAnchor(null); openRename(); }}
                                disabled={!activeRun || deleting || savingNote}
                                data-testid="agent-context-rename-menuitem"
                            >
                                <ListItemIcon><DriveFileRenameOutlineIcon fontSize="small" /></ListItemIcon>
                                <ListItemText primary="Rename…" />
                            </MenuItem>
                            <MenuItem
                                onClick={() => { setCaptureAnchor(null); captureDelete.openDialog(activeRun); }}
                                disabled={!activeRun || deleting || savingNote}
                                sx={{ color: activeRun ? 'error.main' : undefined }}
                                data-testid="agent-context-delete-menuitem"
                            >
                                <ListItemIcon>
                                    <DeleteOutlineIcon
                                        fontSize="small"
                                        sx={{ color: activeRun ? 'error.main' : undefined }}
                                    />
                                </ListItemIcon>
                                <ListItemText primary="Delete" />
                            </MenuItem>
                        </Menu>
                    </Box>

                    {/* Capture provenance actually stored today (req #3065
                        follow-up; machine/model/effort added req #3098),
                        between the picker and the Description — same
                        labeled-field shape as a requirement's Created /
                        Started / Completed fields (RequirementDetail.jsx):
                        bold subtitle2 label, body2 value below. No
                        `activeRun &&` guard: this branch only renders once
                        runsSorted is non-empty, and activeRun's self-healing
                        derivation above already guarantees it's non-null
                        there — same guarantee the Description field below
                        relies on. Model/Effort render as the same Chip
                        components SwarmSessionDetail.jsx uses, unguarded
                        (NOT NULL going forward); Machine only renders when
                        machine_fk is set (NULL for pre-#3098 captures and
                        any capture whose machine resolution failed at store
                        time). */}
                    <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary"
                                        sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>
                                Captured
                            </Typography>
                            <Typography variant="body2" data-testid="agent-context-captured-at">
                                {activeRun.captured_at
                                    ? formatDateTime(activeRun.captured_at, profile?.timezone) : '—'}
                            </Typography>
                        </Box>
                        {activeRun.harness_version && (
                            <Box>
                                <Typography variant="subtitle2" color="text.secondary"
                                            sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>
                                    Harness Version
                                </Typography>
                                <Typography variant="body2" data-testid="agent-context-harness-version">
                                    {activeRun.harness_version}
                                </Typography>
                            </Box>
                        )}
                        {activeRun.machine_fk != null && (
                            <Box>
                                <Typography variant="subtitle2" color="text.secondary"
                                            sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>
                                    Machine
                                </Typography>
                                <Typography variant="body2" data-testid="agent-context-machine">
                                    {machineName || `#${activeRun.machine_fk}`}
                                </Typography>
                            </Box>
                        )}
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary"
                                        sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>
                                Model
                            </Typography>
                            <Chip label={aiModelLabel(activeRun.ai_model)}
                                  size="small"
                                  {...aiModelChipProps(activeRun.ai_model)}
                                  data-testid="agent-context-ai-model" />
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary"
                                        sx={{ fontWeight: 'bold', fontSize: '1.25rem' }}>
                                Effort
                            </Typography>
                            <Chip label={effortLabel(activeRun.effort)}
                                  size="small"
                                  {...effortChipProps(activeRun.effort)}
                                  data-testid="agent-context-effort" />
                        </Box>
                    </Box>

                    {/* House edit-in-place field (GhostTextField's "outlined" mode —
                        same commit contract as InstructionsPage's fields): saves
                        source_note on blur, one PUT, reverts on a rejected write.
                        Always rendered (not gated on source_note being non-empty)
                        so a capture with no description yet can have one typed in;
                        the placeholder carries that invitation when it's blank. */}
                    <GhostTextField
                        key={activeRun.id}
                        value={activeRun.source_note}
                        outlined
                        label="Description"
                        fullWidth
                        multiline
                        placeholder="No description yet — click to add one."
                        normalize={(text) => text.trim()}
                        onCommit={commitSourceNote}
                        testId="agent-context-source-note-input"
                    />

                    <div className="atc-scroll">
                        {/* No <caption> (dropped req #3065 — the page title above already
                            names it); aria-label keeps the table self-describing for
                            screen readers navigating table-by-table. */}
                        <table data-testid="agent-context-table" aria-label="Agentic Telemetry">
                            <thead>
                                <tr>
                                    <th className="agent sortable" rowSpan={2}
                                        onClick={() => handleSort('agent_name')}
                                        data-testid="agent-context-sort-agent_name">
                                        Agent{sortArrow('agent_name')}
                                    </th>
                                    <th className="num sortable" rowSpan={2}
                                        onClick={() => handleSort('boot_time_ms')}
                                        data-testid="agent-context-sort-boot_time_ms">
                                        Boot time<br />(ms){sortArrow('boot_time_ms')}
                                    </th>
                                    <th className="grp" colSpan={3}>FIXED OVERHEAD</th>
                                    <th className="grp" colSpan={3}>Loaded per-agent</th>
                                    <th className="num sortable" rowSpan={2}
                                        onClick={() => handleSort('start_work_context_tokens')}
                                        data-testid="agent-context-sort-start_work_context_tokens">
                                        Agent Init<br />Context{sortArrow('start_work_context_tokens')}
                                    </th>
                                </tr>
                                <tr>
                                    <th className="num sortable" onClick={() => handleSort('cc_base_tokens')}
                                        data-testid="agent-context-sort-cc_base_tokens">
                                        Claude Code{sortArrow('cc_base_tokens')}
                                    </th>
                                    <th className="num sortable" onClick={() => handleSort('claude_md_tokens')}
                                        data-testid="agent-context-sort-claude_md_tokens">
                                        CLAUDE.md{sortArrow('claude_md_tokens')}
                                    </th>
                                    <th className="num sortable" onClick={() => handleSort('charter_stub_tokens')}
                                        data-testid="agent-context-sort-charter_stub_tokens">
                                        Agent File{sortArrow('charter_stub_tokens')}
                                    </th>
                                    <th className="num sortable" onClick={() => handleSort('boot_payload_tokens')}
                                        data-testid="agent-context-sort-boot_payload_tokens">
                                        Agent MCP Payload{sortArrow('boot_payload_tokens')}
                                    </th>
                                    <th className="num sortable" onClick={() => handleSort('autoload_tokens')}
                                        data-testid="agent-context-sort-autoload_tokens">
                                        Architecture Docs{sortArrow('autoload_tokens')}
                                    </th>
                                    <th className="mid sortable" onClick={() => handleSort('docs_loaded')}
                                        data-testid="agent-context-sort-docs_loaded">
                                        Docs Loaded{sortArrow('docs_loaded')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rowsLoading ? (
                                    <tr><td className="agent"><CircularProgress size={16} /></td>
                                        <td colSpan={8} /></tr>
                                ) : rendered.list.map((r, idx) => {
                                    const c = computeCells(r, rendered.markerByText);
                                    // A cell string that equals the n/a sentinel renders muted.
                                    const cell = (text) => (text === NA_TEXT
                                        ? <span className="fn">n/a</span> : text);
                                    const isExpanded = expandedDocRows.has(r.id);
                                    // req #3096: zebra striping is keyed off this JS index, not
                                    // CSS `nth-of-type`, because the optional detail <tr> below
                                    // is a real sibling in the same <tbody> — nth-of-type counts
                                    // it as an element, so expanding any row would shift every
                                    // later row's parity and visibly reshuffle stripes on a
                                    // read-only inspection action.
                                    const rowClasses = [
                                        c.isPrimary ? 'primary' : null,
                                        idx % 2 === 1 ? 'even-row' : null,
                                    ].filter(Boolean).join(' ') || undefined;
                                    return (
                                        <Fragment key={r.id}>
                                            <tr className={rowClasses}
                                                data-testid={`agent-context-row-${r.id}`}>
                                                <td className="agent">{r.agent_name}</td>
                                                <td className="num">{cell(c.bootMs)}</td>
                                                <td className="num">
                                                    {cell(c.ccBase)}
                                                    {c.ccBaseMarker && <span className="fn">{c.ccBaseMarker}</span>}
                                                </td>
                                                <td className="num">{cell(c.claudeMd)}</td>
                                                <td className="num">
                                                    {c.stub.kind === 'value'
                                                        ? c.stub.text
                                                        : (
                                                            <span className="fn">
                                                                {c.stub.kind === 'marker'
                                                                    ? <>Not Captured{c.stub.text}</> : 'n/a'}
                                                            </span>
                                                        )}
                                                </td>
                                                <td className="num">{cell(c.bootPayload)}</td>
                                                <td className="num">{cell(c.autoload)}</td>
                                                <td className={`mid${c.docsIncomplete ? ' docs-warn' : ''}${c.docsClickable ? ' docs-clickable' : ''}`}
                                                    onClick={c.docsClickable ? () => toggleDocsExpanded(r.id) : undefined}
                                                    data-testid={`agent-context-docs-cell-${r.id}`}>
                                                    {cell(c.docs)}
                                                    {c.docsClickable && (
                                                        <ArrowDropDownIcon
                                                            fontSize="small"
                                                            sx={{
                                                                verticalAlign: 'middle', ml: '-2px',
                                                                transform: isExpanded ? 'rotate(180deg)' : 'none',
                                                            }}
                                                        />
                                                    )}
                                                </td>
                                                <td className="num swc">{c.swc}</td>
                                            </tr>
                                            {isExpanded && <AgentDocsDetail rowId={r.id} />}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Box>
            )}

            <Dialog
                open={glossaryOpen}
                onClose={() => setGlossaryOpen(false)}
                maxWidth="sm"
                fullWidth
                data-testid="agent-context-glossary-dialog"
            >
                <DialogTitle id="agent-context-glossary-title">Glossary</DialogTitle>
                <DialogContent dividers data-testid="agent-context-glossary">
                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'minmax(140px, 180px) 1fr' },
                        gap: 1.5,
                    }}>
                        {GLOSSARY.map(([term, def]) => (
                            <Fragment key={term}>
                                <Typography variant="subtitle2">{term}</Typography>
                                <Typography variant="body2" color="text.secondary">{def}</Typography>
                            </Fragment>
                        ))}
                        {[...rendered.markerByText.entries()].map(([text, mark]) => (
                            <Fragment key={mark}>
                                <Typography variant="subtitle2">{mark}</Typography>
                                <Typography variant="body2" color="text.secondary">{text}</Typography>
                            </Fragment>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setGlossaryOpen(false)} variant="outlined" autoFocus>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={renameOpen}
                onClose={() => setRenameOpen(false)}
                data-testid="agent-context-rename-dialog"
            >
                <DialogTitle>Rename Capture</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        margin="dense"
                        label="Capture name"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && renameValue.trim()) confirmRename(); }}
                        inputProps={{ maxLength: 256, 'data-testid': 'agent-context-rename-input' }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenameOpen(false)} variant="outlined">
                        Cancel
                    </Button>
                    <Button
                        onClick={confirmRename}
                        variant="outlined"
                        disabled={!renameValue.trim() || renaming}
                        data-testid="agent-context-rename-confirm"
                    >
                        Rename
                    </Button>
                </DialogActions>
            </Dialog>

            <ContextDeleteDialog
                deleteDialogOpen={captureDelete.dialogOpen}
                setDeleteDialogOpen={captureDelete.setDialogOpen}
                setDeleteId={captureDelete.setInfoObject}
                setDeleteConfirmed={captureDelete.setConfirmed}
                run={captureDelete.infoObject}
                // `rendered.list` tracks activeRun's rows, not the run frozen in the
                // dialog at open-time — if the runs list reorders while the dialog is
                // open (a background refetch promotes a newer capture to "active"),
                // those two can drift apart. Only show the count when they still
                // agree; a stale-but-plausible number is worse than none right before
                // an irreversible delete.
                agentCount={(!rowsLoading && activeRun?.id === captureDelete.infoObject?.id)
                    ? rendered.list.length : null}
            />
        </Box>
    );
};

export default ContextPage;
