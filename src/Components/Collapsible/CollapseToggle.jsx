// The Show more / Show less control shared by CollapsibleText,
// CollapsibleGhostField (req #3572) and the pipeline card goal (req #3945), so
// every collapse surface reads the same.
//
// AT THE TOP RIGHT of the field it controls (user direction during manual
// review) — a fixed spot above the field is where the eye lands before reading.
// Callers render it ONLY when the collapsed text really hides something
// (req #4144: a toggle that shows no more is clutter).

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const CollapseToggle = ({ expanded, onToggle, testId }) => (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
        <Button
            size="small"
            onClick={onToggle}
            // Keep focus where it is: the toggle beside an editable field must not
            // steal focus from it (that would fire the field's blur and commit).
            onMouseDown={(e) => e.preventDefault()}
            startIcon={expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            aria-expanded={expanded}
            sx={{ px: 0.5, py: 0, minWidth: 0, textTransform: 'none', fontSize: '0.75rem' }}
            data-testid={testId}
        >
            {expanded ? 'Show less' : 'Show more'}
        </Button>
    </Box>
);

export default CollapseToggle;
