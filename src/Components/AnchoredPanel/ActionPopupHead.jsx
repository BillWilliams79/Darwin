// ActionPopupHead.jsx — the head row of every Action Popup (req #3821): the
// ONE implementation, so the family lines up wherever it is drawn — floating,
// or stacked in the navbar's rack, where the heads sit one above another.
// AnchoredPanel draws it; the Orchestrables box, which draws its own frame,
// draws the same one. Pattern doc: memory/anchored-collapse-pattern.md
// § The head row.
//
//    ▾  (7)  DEV SERVERS ······························· ×
//    ▾       DEV SERVER
//
// THE BADGE SLOT IS ALWAYS THERE (user directive: "Collapse, Badge, Title …
// should all line up"). A popup with no count keeps a blank slot one badge
// circle wide, so its title starts where a counted popup's does. Only a badge
// wider than its circle — two digits, a wide glyph — pushes its title on.
//
// THE ROW IS ONE HEIGHT: tall enough for its tallest item (the ×), whatever
// the popup puts in it, so folded popups in the rack are one height too.
//
// It owns no gesture: the host spreads its move handlers, testid and tooltip
// onto the row (`...rowProps`) and takes the row's element by `ref`.

import { forwardRef } from 'react';

import Box from '@mui/material/Box';

import CollapseHead from './CollapseHead';
import {
    ACTION_POPUP_BADGE_EM, ACTION_POPUP_COLORS, ACTION_POPUP_HEAD_EM, ACTION_POPUP_MONO,
} from './actionPopupChrome';
import { PLAN_VIZ_PALETTE as P } from '../../SwarmView/pipelines/pipelinePlanLayout';

/** The head row's side padding and its gap between items, em. */
export const ACTION_POPUP_HEAD_PAD_EM = 0.7;
export const ACTION_POPUP_HEAD_GAP_EM = 0.6;
/** The title's type, in the head's em (the ▾ is drawn at the same size). */
export const ACTION_POPUP_TITLE_EM = 0.9;
/** The title's tracking, in its own em. */
export const ACTION_POPUP_TITLE_TRACKING_EM = 0.06;
/** A badge's side padding, em: a capsule past one digit. */
export const ACTION_POPUP_BADGE_PAD_EM = 0.35;

/** The count badge — the step card's green pill (req #3503): a circle for one
 *  digit, a capsule past it. `fill`/`text` recolour it (the Orchestrables box
 *  wears its swarm-ready colour). */
export function ActionPopupBadge({ children, testid, fill = P.badgeFill, text = P.badgeText, title }) {
    return (
        <Box component="span" data-testid={testid} title={title}
             sx={{ display: 'inline-flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0,
                    minWidth: ACTION_POPUP_BADGE_EM, height: ACTION_POPUP_BADGE_EM,
                    px: `${ACTION_POPUP_BADGE_PAD_EM}em`,
                    boxSizing: 'border-box', borderRadius: '999px',
                    bgcolor: fill, color: text,
                    fontFamily: ACTION_POPUP_MONO, fontWeight: 700, lineHeight: 1 }}>
            {children}
        </Box>
    );
}

/** The Action Popups' × — upper right, where the window can be closed (req #3741). */
export function ActionPopupClose({ onClick, label, testid }) {
    return (
        <Box component="button" type="button" onClick={onClick}
             aria-label={label} title={label} data-testid={testid}
             sx={{ width: '1.4em', height: '1.4em', p: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', border: 'none',
                    borderRadius: '0.4em', color: P.text, cursor: 'pointer',
                    fontFamily: ACTION_POPUP_MONO, fontSize: '1.1em', lineHeight: 1,
                    '&:hover': { color: P.accent } }}>
            ×
        </Box>
    );
}

/**
 * @param {Object} props
 * @param {boolean} props.open        the popup is showing its body
 * @param {function} props.onToggle   the ▾'s click
 * @param {string} props.name         the popup's name — the ▾'s accessible name
 * @param {string} props.testid       the popup's testid; parts are suffixed
 *   (`-toggle`, `-badge` (the slot), `-title`)
 * @param {React.ReactNode} [props.badge]    in the badge slot; blank = none
 * @param {React.ReactNode} [props.label]    the title as drawn; defaults to `name`
 * @param {React.ReactNode} [props.actions]  open: far right; folded: right
 *   after the title (the whole package tight)
 * @param {boolean} [props.narrow]    the icon-only navbar: the ▾ and badge alone
 * @param {{head, headHover, line}} [props.colors]
 * @param {Object} [props.titleSx]    the title's flex behaviour, where the host
 *   sizes itself to it (the Orchestrables box's folded bar)
 * @param {Object} [props.sx]         more row style (cursor)
 */
const ActionPopupHead = forwardRef(function ActionPopupHead({
    open, onToggle, name, testid, badge = null, label, actions = null, narrow = false,
    colors = ACTION_POPUP_COLORS, titleSx, sx, ...rowProps
}, ref) {
    return (
        <Box ref={ref} data-testid={`${testid}-header`} {...rowProps}
             sx={{ display: 'flex', alignItems: 'center', gap: `${ACTION_POPUP_HEAD_GAP_EM}em`,
                    px: `${ACTION_POPUP_HEAD_PAD_EM}em`, py: '0.3em',
                    minHeight: `${ACTION_POPUP_HEAD_EM}em`, boxSizing: 'border-box',
                    flexShrink: 0, minWidth: 0, touchAction: 'none',
                    ...(open && colors.line && { borderBottom: `1px solid ${colors.line}` }),
                    ...sx }}>
            <CollapseHead open={open} onToggle={onToggle} name={name}
                          testid={`${testid}-toggle`}
                          color={colors.head} hoverColor={colors.headHover}
                          fontSize={`${ACTION_POPUP_TITLE_EM}em`} showName={false} />
            <Box component="span" data-testid={`${testid}-badge`}
                 sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                        minWidth: ACTION_POPUP_BADGE_EM }}>
                {badge}
            </Box>
            {/* The title, in the head's own small caps. Not a button:
                pressing it starts a move, like the rest of the row. */}
            {!narrow && (
                <Box component="span" data-testid={`${testid}-title`}
                     sx={{ color: colors.head, fontSize: `${ACTION_POPUP_TITLE_EM}em`, fontWeight: 700,
                            letterSpacing: `${ACTION_POPUP_TITLE_TRACKING_EM}em`, textTransform: 'uppercase',
                            whiteSpace: 'nowrap', overflow: 'hidden',
                            textOverflow: 'ellipsis', minWidth: 0, ...titleSx }}>
                    {label ?? name}
                </Box>
            )}
            {/* Open: far right. Folded: right after the title. */}
            {!narrow && actions != null && (
                <Box sx={{ ml: open ? 'auto' : 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {actions}
                </Box>
            )}
        </Box>
    );
});

export default ActionPopupHead;
