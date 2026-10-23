// enginePanelParts.jsx — the small pieces every engine panel is built from
// (req #3760): a panel caption, a label/value row, and a chip in one of the
// vocabulary's colours.

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { codeColor, codeLabel, plainWords } from './engineVocabulary';

export function PanelTitle({ children }) {
    return (
        <Typography variant="overline" component="h3"
                    sx={{ display: 'block', lineHeight: 1.6, color: 'text.secondary', mb: 0.5 }}>
            {children}
        </Typography>
    );
}

export function Field({ label, children, testid }) {
    return (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', minWidth: 0, py: 0.25 }}>
            <Typography variant="caption" color="text.secondary"
                        sx={{ width: 92, flexShrink: 0 }}>
                {label}
            </Typography>
            <Typography variant="body2" component="div" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                        data-testid={testid}>
                {children}
            </Typography>
        </Box>
    );
}

/** A filled chip whose fill is `color`; text is black, which every palette fill clears. */
export function ToneChip({ label, color, title, testid, sx }) {
    const chip = (
        <Chip size="small" label={label} data-testid={testid}
              sx={{ bgcolor: color, color: '#000', fontWeight: 600, height: 22, ...sx }} />
    );
    return title ? <Tooltip title={title}>{chip}</Tooltip> : chip;
}

/** A hold code / event code as its chip, the plain words on hover. */
export function CodeChip({ code, testid }) {
    return <ToneChip label={codeLabel(code)} color={codeColor(code)} title={plainWords(code)}
                     testid={testid} />;
}
