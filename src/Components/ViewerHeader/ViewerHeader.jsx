// The canonical Darwin viewer header, as a component (req #3067).
//
// Every Darwin VIEWER page — a page whose job is to list one dataset — opens with
// the same row, in the same reading order:
//
//     [ view toggle ] [ title, flex:1 ] [ filters ] [ settings ] [ actions ]
//                       ──────── accounting line ────────
//
// The toggle leads so the title starts at the same x-position on every viewer;
// that is the whole reason it is first rather than the title. Filters sit beside
// the title because they change WHAT is listed. The gear is pinned right because
// that is where SwarmView already puts settings.
//
// WHY IT IS A COMPONENT NOW. The rules (V1–V8 in
// memory/view-switchable-pages.md § I) were issued in req #3013 and re-stated in
// #3063, and by the time #3067 opened there were THREE hand-rolled copies —
// AgentsPage, InstructionsPage, DocumentsPage — which had already drifted:
// AgentsPage was the codebase's single user of TableRowsIcon over the canonical
// TableChartIcon, used a non-conforming storage key, and had no accounting line at
// all despite silently filtering closed rows out of its own list. Rules that live
// only in prose drift; rules a component enforces cannot.
//
// WHAT IS DELIBERATELY NOT CONFIGURABLE. The order of the children. A page that
// wants filters left of the title, or the toggle anywhere but first, does not want
// this component — it is not a viewer. `sx` reaches the header row only, and an
// `sx` carrying `flexDirection`, `order` or `justifyContent` is a code-review
// reject. See memory/darwin-viewer-pages.md.

import { useState } from 'react';

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import SettingsIcon from '@mui/icons-material/Settings';

import { normalizeView } from './normalizeView';

const ViewerHeader = ({
    // Rendered `variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}`. The component
    // owns the media query so no caller has to remember the breakpoint.
    title,
    // [{ value, label, icon, disabled?, disabledReason? }]
    //
    // `label` is REQUIRED and is never rendered as text: the shipped viewer
    // toggles are icon-only with a Tooltip (V5 governs which icon, not whether
    // there is a caption), so `label` becomes the aria-label and the tooltip.
    views = [],
    view,
    // Pass useViewPreference's setter directly — it already null-guards the
    // deselect click that ToggleButtonGroup sends in exclusive mode.
    onViewChange,
    // Node, right of the title. Chips that change WHAT is listed.
    filters,
    // [{ id, heading, items: [{ id, label, icon, selected?, trailing?, onClick }] }]
    //
    // Omit ⇒ no gear at all. `onClick` is called with a `close` callback rather
    // than closing automatically: re-picking the ACTIVE sort mode must reverse it
    // and KEEP THE MENU OPEN so the arrow flip is visible (the shipped CategoryCard
    // idiom), while adopting a new mode closes. The component cannot infer which
    // of those a given item is, so it delegates the decision instead of guessing.
    settingsItems,
    // Node, far right.
    actions,
    // The sub-header line. Omit ⇒ not rendered.
    accounting,
    // Derives `<prefix>-view-toggle`, `<prefix>-settings-button`,
    // `<prefix>-sort-menu`, `<prefix>-accounting`, and each menu item's
    // `<prefix>-<groupId>-<itemId>`. Per-button ids stay literal:
    // `view-toggle-<value>`.
    testIdPrefix,
    // Escape hatch, applied to the header ROW ONLY — never to the title, toggle,
    // gear, menu or accounting line. Caller wins on conflict.
    sx = {},
    // For pages on the `.app-content-planpage` CSS grid, which assign grid areas by
    // CLASS (`app-content-view-toggle`), not by sx.
    className,
}) => {
    const isMobile = useMediaQuery('(max-width:899px)');
    // The gear anchor is pure presentation with no page semantics, every caller
    // wrote the identical three lines, and owning it is what lets this component
    // guarantee the menu's testid and the between-group Dividers.
    const [settingsAnchor, setSettingsAnchor] = useState(null);

    // Defensive second line. The PAGE must normalize too — its conditional render
    // has to branch on the same value, or the header shows Cards selected while the
    // body renders a Table that does not exist — but a caller who forgets still
    // gets a toggle with an active state rather than a dead one.
    const activeView = normalizeView(view, views);

    const closeSettings = () => setSettingsAnchor(null);

    return (
        <>
            <Box
                className={className}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    // The accounting line supplies its own bottom margin when it is
                    // there; without it the row has to carry the gap itself.
                    mb: accounting ? 0.5 : 2,
                    flexWrap: 'wrap',
                    ...sx,
                }}
            >
                {/* V1 — always first, always rendered, even at length 1. A group
                    with one child still holds the far-left anchor and keeps the
                    title's x-position stable against the other viewers. */}
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={activeView}
                    onChange={(_e, v) => onViewChange(v)}
                    sx={{ flexShrink: 0 }}
                    data-testid={`${testIdPrefix}-view-toggle`}
                >
                    {views.map(({ value, label, icon: Icon, disabled, disabledReason }) => {
                        const button = (
                            <ToggleButton
                                value={value}
                                disabled={!!disabled}
                                aria-label={label}
                                data-testid={`view-toggle-${value}`}
                            >
                                <Icon fontSize="small" />
                            </ToggleButton>
                        );
                        // MUI cannot fire a Tooltip on a disabled button — the
                        // button carries `pointer-events: none`, so no mouse event
                        // ever reaches it. The documented fix is a wrapper element,
                        // and it is SAFE HERE specifically: MUI v7's
                        // ToggleButtonGroup passes value/onChange/position down
                        // through CONTEXT rather than cloneElement, so an
                        // intervening span cannot break grouping. (#3063 used a
                        // `pointerEvents: auto` override instead; it was never
                        // verified to work and is not reinstated here.)
                        return disabled ? (
                            <Tooltip key={value} title={disabledReason || label}>
                                <span style={{ display: 'inline-flex' }}>{button}</span>
                            </Tooltip>
                        ) : (
                            <Tooltip key={value} title={label}>{button}</Tooltip>
                        );
                    })}
                </ToggleButtonGroup>

                {/* V2 — the title carries flex:1 and IS the spacer. There is
                    deliberately no separate flexGrow Box; adding one is the exact
                    failure the rule exists to prevent. */}
                <Typography variant={isMobile ? 'h6' : 'h5'} sx={{ flex: 1 }}>
                    {title}
                </Typography>

                {/* V3 — filters, then settings, then actions. Never interleaved. */}
                {filters}

                {settingsItems && settingsItems.length > 0 && (
                    <>
                        <Tooltip title="Sort & display settings">
                            <IconButton
                                size="small"
                                onClick={(e) => setSettingsAnchor(e.currentTarget)}
                                sx={{ flexShrink: 0 }}
                                data-testid={`${testIdPrefix}-settings-button`}
                            >
                                <SettingsIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Menu
                            anchorEl={settingsAnchor}
                            open={!!settingsAnchor}
                            onClose={closeSettings}
                            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            // `slotProps.list` is the MUI v7 path for props on the
                            // MenuList; the older `MenuListProps` is deprecated in
                            // @mui/material@7.3.7's own type declarations.
                            //
                            // The name is `-sort-menu`, not `-settings-menu`, on a
                            // component that can hold non-sort groups. That is a
                            // wart, and a deliberate one: the shipped E2E suite
                            // reaches for `instructions-sort-menu`, and renaming a
                            // testid is a test-architecture change rather than a
                            // side effect of extracting a component.
                            slotProps={{ list: { 'data-testid': `${testIdPrefix}-sort-menu` } }}
                        >
                            {settingsItems.flatMap((group, gi) => [
                                // Between groups only — a leading rule above the
                                // first subheader reads as a stray line.
                                gi > 0 ? <Divider key={`divider-${group.id}`} /> : null,
                                <ListSubheader key={`heading-${group.id}`} disableSticky
                                               sx={{ lineHeight: '32px' }}>
                                    {group.heading}
                                </ListSubheader>,
                                ...group.items.map(item => (
                                    <MenuItem
                                        key={item.id}
                                        selected={!!item.selected}
                                        onClick={() => item.onClick(closeSettings)}
                                        data-testid={`${testIdPrefix}-${group.id}-${item.id}`}
                                    >
                                        <ListItemIcon>{item.icon}</ListItemIcon>
                                        <ListItemText>{item.label}</ListItemText>
                                        {/* Carries the sort-direction arrow. It is
                                            the only affordance saying that
                                            re-picking the active mode reverses it,
                                            so it is not decorative. */}
                                        {item.trailing}
                                    </MenuItem>
                                )),
                            ]).filter(Boolean)}
                        </Menu>
                    </>
                )}

                {actions}
            </Box>

            {/* V7 — a separate body2/text.secondary line BELOW the row, counting the
                WHOLE dataset. A count that changed when you toggled a view filter
                would not be an accounting line. */}
            {accounting && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}
                            data-testid={`${testIdPrefix}-accounting`}>
                    {accounting}
                </Typography>
            )}
        </>
    );
};

export default ViewerHeader;
