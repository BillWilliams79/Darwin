// /agents/context — Agent Context: Actual Tokens (req #3031).
//
// Renders the published visual-acceptance artifact
// (660a8b6b-b215-4b7a-b5a4-91c31e82460d) VERBATIM from stored telemetry: the
// multi-row grouped header [Boot time | Initial context: CC base / CLAUDE.md /
// Charter stub | Loaded per-agent: Boot payload / Autoload / Docs | Start Work
// Context], zebra rows, a sticky Agent column, the teal Start-Work-Context
// emphasis, and the glossary block. A run picker selects which capture to show;
// variable agent counts render as-is (nothing assumes a fixed roster).
//
// All values are ACTUAL tokens (real tokenizer via transcript usage deltas),
// except Boot time (ms). Columns are NULL where a phase does not apply
// (PrimaryAI has no boot/autoload; the Code Reviewer bundles its charter stub
// into CC base) — those cells render "n/a" or a footnote marker, matching the
// artifact.

import '../index.css';
import { Fragment, useContext, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import CircularProgress from '@mui/material/CircularProgress';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import AuthContext from '../Context/AuthContext';
import { useAgentTelemetryRuns, useAgentTelemetryRowsByRun } from '../hooks/useDataQueries';
import { NA as NA_TEXT, sortRows, assignMarkers, computeCells } from './contextRenderUtils';

// The 9 fixed column definitions — verbatim from the artifact glossary. The
// per-row footnote definitions (*, †, …) are appended dynamically per run.
const GLOSSARY = [
    ['Units', <>All values are <strong>actual tokens</strong> (real tokenizer, from transcript usage deltas), except <strong>Boot time</strong> which is milliseconds.</>],
    ['Boot time', <>Latency of the <code>darwin://agents/&lt;Name&gt;</code> boot call, measured <strong>sequentially</strong> (one boot at a time; parallel launch inflates it ~2&times;).</>],
    ['CC base', <>The Claude Code system prompt: harness instructions + tool schemas + skills listing + MCP listing. Equals Initial context minus CLAUDE.md and the charter stub.</>],
    ['CLAUDE.md', <>The project instruction file, loaded into every session.</>],
    ['Charter stub', <>The agent's <code>.claude/agents/*.md</code> file, loaded as its system prompt.</>],
    ['Boot payload', <>Context added by the boot call — identity row, binding instructions, and document pointers (not document contents).</>],
    ['Autoload', <>Context added by reading the agent's autoload documents in full.</>],
    ['Docs', <>Autoload documents loaded / expected.</>],
    ['Start Work Context', <>Total context once loaded and ready to work — the <code>/context</code> figure.</>],
];

function cssVars(mode) {
    // The artifact's two palettes, keyed off the MUI theme mode so the page
    // tracks Darwin's light/dark toggle (not prefers-color-scheme).
    return mode === 'dark'
        ? {
            '--panel': '#151a22', '--ink': '#e7ebf1', '--muted': '#8b94a3',
            '--line': '#232b36', '--line-strong': '#333d4b', '--head': '#1a212b',
            '--accent': '#2dd4bf', '--accent-soft': '#2dd4bf1f', '--zebra': '#121821',
        }
        : {
            '--panel': '#ffffff', '--ink': '#171c26', '--muted': '#5c6675',
            '--line': '#e3e8ee', '--line-strong': '#cdd5df', '--head': '#eef2f6',
            '--accent': '#0f766e', '--accent-soft': '#0f766e14', '--zebra': '#fafbfc',
        };
}

// Scoped CSS — every selector under .atc-root so nothing leaks into the app.
const TABLE_CSS = `
.atc-root { --mono: ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
.atc-scroll { overflow-x:auto; border:1px solid var(--line); border-radius:12px; background:var(--panel); }
.atc-root table { border-collapse:collapse; width:100%; font-size:13.5px; }
.atc-root caption { caption-side:top; text-align:left; padding:14px 16px 12px; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.atc-root thead th { background:var(--head); color:var(--ink); font-weight:600; padding:9px 13px; border-bottom:1px solid var(--line-strong); white-space:nowrap; }
.atc-root thead tr:first-of-type th { font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--line); }
.atc-root .grp { text-align:center; border-left:1px solid var(--line); border-right:1px solid var(--line); }
.atc-root th.num, .atc-root td.num { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }
.atc-root th.mid, .atc-root td.mid { text-align:center; }
.atc-root th.agent, .atc-root td.agent { text-align:left; position:sticky; left:0; background:var(--panel); font-weight:600; white-space:nowrap; box-shadow:1px 0 0 var(--line); }
.atc-root thead th.agent { background:var(--head); }
.atc-root tbody td { padding:8px 13px; border-bottom:1px solid var(--line); color:var(--ink); }
.atc-root tbody tr:nth-of-type(even) td { background:var(--zebra); }
.atc-root tbody tr:nth-of-type(even) td.agent { background:var(--zebra); }
.atc-root tbody tr:hover td, .atc-root tbody tr:hover td.agent { background:var(--accent-soft); }
.atc-root .swc { font-weight:700; color:var(--accent); }
.atc-root tr.primary td { border-top:2px solid var(--line-strong); }
.atc-root tr.primary td.agent { color:var(--accent); }
.atc-root .fn { color:var(--muted); font-family:inherit; }
.atc-root dl { margin:0; display:grid; grid-template-columns:minmax(140px,180px) 1fr; gap:1px; background:var(--line); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.atc-root dt { background:var(--panel); padding:10px 14px; font-weight:600; font-size:13px; color:var(--ink); }
.atc-root dd { background:var(--panel); padding:10px 14px; margin:0; color:var(--muted); font-size:13px; }
.atc-root dt code, .atc-root dd code { font-family:var(--mono); font-size:.9em; color:var(--ink); }
.atc-root .gloss-h2 { font-size:12px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin:0 0 14px; font-weight:600; }
@media (max-width:560px){ .atc-root dl{ grid-template-columns:1fr; } .atc-root dt{ padding-bottom:2px; } .atc-root dd{ padding-top:2px; } }
`;

const NA = <span className="fn">n/a</span>;

const ContextPage = () => {
    const { profile } = useContext(AuthContext);
    const theme = useTheme();
    const isMobile = useMediaQuery('(max-width:899px)');
    const creatorFk = profile?.userName;

    const { data: runs, isLoading: runsLoading } = useAgentTelemetryRuns(creatorFk);

    // Runs arrive newest-first (captured_at:desc); default to the newest capture.
    const [selectedId, setSelectedId] = useState(null);
    const runsSorted = useMemo(() => runs || [], [runs]);
    const activeRunId = selectedId ?? runsSorted[0]?.id ?? null;
    const activeRun = useMemo(
        () => runsSorted.find(r => r.id === activeRunId) || null,
        [runsSorted, activeRunId]);

    const { data: rows, isLoading: rowsLoading } = useAgentTelemetryRowsByRun(activeRunId);

    const rendered = useMemo(() => {
        const list = sortRows(rows);
        return { list, markerByText: assignMarkers(list) };
    }, [rows]);

    const dateLabel = (r) => {
        const d = r.captured_at ? String(r.captured_at).slice(0, 10) : '';
        return d ? `${r.label} — ${d}` : r.label;
    };

    if (runsLoading) {
        return <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }}><CircularProgress /></Box>;
    }

    const vars = cssVars(theme.palette.mode);

    return (
        <Box sx={{ gridArea: 'content', p: isMobile ? 1 : 3 }} data-testid="agent-context-page">
            <style>{TABLE_CSS}</style>

            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
                <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}>
                    Agent Context — Actual Tokens
                </Typography>
                {runsSorted.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 260 }}>
                        <InputLabel id="atc-run-label">Capture</InputLabel>
                        <Select
                            labelId="atc-run-label"
                            label="Capture"
                            value={activeRunId ?? ''}
                            onChange={(e) => setSelectedId(e.target.value)}
                            data-testid="agent-context-run-picker"
                        >
                            {runsSorted.map(r => (
                                <MenuItem key={r.id} value={r.id} data-testid={`agent-context-run-option-${r.id}`}>
                                    {dateLabel(r)}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}
            </Box>

            {runsSorted.length === 0 ? (
                <Typography color="text.secondary" sx={{ p: 2 }}>
                    No telemetry captures recorded yet.
                </Typography>
            ) : (
                <Box className="atc-root" sx={{ ...vars, display: 'flex', flexDirection: 'column', gap: '34px', maxWidth: 1120 }}>
                    {activeRun?.source_note && (
                        <Typography variant="body2" color="text.secondary" data-testid="agent-context-source-note">
                            {activeRun.source_note}
                        </Typography>
                    )}

                    <div className="atc-scroll">
                        <table data-testid="agent-context-table">
                            <caption>Agent context — actual tokens</caption>
                            <thead>
                                <tr>
                                    <th className="agent" rowSpan={2}>Agent</th>
                                    <th className="num" rowSpan={2}>Boot time<br />(ms)</th>
                                    <th className="grp" colSpan={3}>Initial context — fixed overhead</th>
                                    <th className="grp" colSpan={3}>Loaded per-agent</th>
                                    <th className="num" rowSpan={2}>Start Work<br />Context</th>
                                </tr>
                                <tr>
                                    <th className="num">CC base</th>
                                    <th className="num">CLAUDE.md</th>
                                    <th className="num">Charter stub</th>
                                    <th className="num">Boot payload</th>
                                    <th className="num">Autoload</th>
                                    <th className="mid">Docs</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rowsLoading ? (
                                    <tr><td className="agent"><CircularProgress size={16} /></td>
                                        <td colSpan={8} /></tr>
                                ) : rendered.list.map((r) => {
                                    const c = computeCells(r, rendered.markerByText);
                                    // A cell string that equals the n/a sentinel renders muted.
                                    const cell = (text) => (text === NA_TEXT
                                        ? <span className="fn">n/a</span> : text);
                                    return (
                                        <tr key={r.id} className={c.isPrimary ? 'primary' : undefined}
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
                                                    : <span className="fn">{c.stub.kind === 'marker' ? c.stub.text : 'n/a'}</span>}
                                            </td>
                                            <td className="num">{cell(c.bootPayload)}</td>
                                            <td className="num">{cell(c.autoload)}</td>
                                            <td className="mid">{cell(c.docs)}</td>
                                            <td className="num swc">{c.swc}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <section>
                        <h2 className="gloss-h2">Glossary</h2>
                        <dl data-testid="agent-context-glossary">
                            {GLOSSARY.map(([term, def]) => (
                                <Fragment key={term}>
                                    <dt>{term}</dt><dd>{def}</dd>
                                </Fragment>
                            ))}
                            {[...rendered.markerByText.entries()].map(([text, mark]) => (
                                <Fragment key={mark}>
                                    <dt>{mark}</dt><dd>{text}</dd>
                                </Fragment>
                            ))}
                        </dl>
                    </section>
                </Box>
            )}
        </Box>
    );
};

export default ContextPage;
