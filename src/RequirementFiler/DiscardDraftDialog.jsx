// DiscardDraftDialog.jsx — the question the requirement editor asks when its
// × (or Esc) would drop a NEW requirement the reader has typed into and not
// created (req #4198). In the Action Popups' own look (actionPopupChrome.js —
// the family's frame colour, mono type, dark panel, pill buttons) rather than a
// browser confirm, over a dimmed page. "Keep editing" is the default (focused;
// Esc and a click outside also keep), so the careless press loses nothing.

import Box from '@mui/material/Box';
import Modal from '@mui/material/Modal';

import { ACTION_POPUP_COLORS as C, ACTION_POPUP_FONT_PX, ACTION_POPUP_MONO } from '../Components/AnchoredPanel/actionPopupChrome';
import { PLAN_VIZ_PALETTE as P } from '../SwarmView/pipelines/pipelinePlanLayout';
import { EDITOR_Z } from './filerHover';

const WARN = '#ff8a80';
const BUTTON_SX = {
    px: '1em', py: '0.3em', border: `1px solid ${P.text}`, borderRadius: '999px',
    background: 'transparent', color: P.text, fontFamily: ACTION_POPUP_MONO,
    fontSize: '1em', fontWeight: 700, cursor: 'pointer',
    '&:hover': { color: P.accent, borderColor: P.accent },
};

/**
 * @param {boolean} open
 * @param {string} title       the draft's title, quoted back (may be blank)
 * @param {() => void} onKeep     keep editing
 * @param {() => void} onDiscard  drop the draft and close the editor
 */
export default function DiscardDraftDialog({ open, title, onKeep, onDiscard }) {
    const name = (title ?? '').trim();
    const shown = name.length > 60 ? `${name.slice(0, 60)}…` : name;
    return (
        <Modal open={open} onClose={onKeep} data-testid="requirement-editor-discard-dialog"
               sx={{ zIndex: EDITOR_Z + 10 }}
               slotProps={{ backdrop: { sx: { backgroundColor: 'rgba(5, 8, 14, 0.6)' } } }}>
            <Box role="alertdialog" aria-labelledby="requirement-editor-discard-title"
                 sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        width: 'min(26em, calc(100vw - 2em))', boxSizing: 'border-box', outline: 'none',
                        fontFamily: ACTION_POPUP_MONO, fontSize: `${ACTION_POPUP_FONT_PX}px`, color: C.text,
                        background: C.background, border: `2px solid ${C.frame}`, borderRadius: '0.8em',
                        boxShadow: '0 0.5em 1.5em rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(2px)',
                        px: '1.2em', py: '1em', display: 'flex', flexDirection: 'column', gap: '0.8em' }}>
                <Box id="requirement-editor-discard-title" component="div"
                     sx={{ fontSize: '1.15em', fontWeight: 700, color: WARN }}>
                    Discard this requirement?
                </Box>
                <Box data-testid="requirement-editor-discard-message" sx={{ lineHeight: 1.45 }}>
                    {shown ? <>“{shown}” has not been created.</> : <>This requirement has not been created.</>}
                    {' '}Closing the editor now discards what you typed — it cannot be recovered.
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6em', mt: '0.2em' }}>
                    <Box component="button" type="button" onClick={onDiscard}
                         data-testid="requirement-editor-discard-yes"
                         sx={{ ...BUTTON_SX, color: WARN, borderColor: WARN }}>
                        Discard
                    </Box>
                    <Box component="button" type="button" onClick={onKeep} autoFocus
                         data-testid="requirement-editor-discard-keep"
                         sx={BUTTON_SX}>
                        Keep editing
                    </Box>
                </Box>
            </Box>
        </Modal>
    );
}
