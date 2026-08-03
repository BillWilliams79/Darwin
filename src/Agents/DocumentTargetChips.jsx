// WHAT IS IN THE DATABASE VERSUS WHAT IS A REAL FILE (req #3101, § 2).
//
// An `architecture_documents` row registers a location; it does not contain, own
// or verify a file. Three facts follow, and none of them was visible on the
// resting card before this component existed:
//
//   1. Deleting the row deletes the REGISTRATION. The file is untouched. (Said
//      today only inside DocumentDeleteDialog, i.e. only to somebody already
//      committed to deleting.)
//   2. Nothing anywhere resolves `location`. Not the browser, which has no
//      filesystem; not Lambda-Rest, which stores a VARCHAR; not the MCP daemon,
//      which hands the string to an agent. The first thing that tries is an LLM at
//      boot, and it fails silently — instruction #83 tells it to read the file, so
//      a wrong path means it boots without knowledge it was told to have and
//      reports itself green.
//   3. `url` and `location` are DIFFERENT KINDS OF THING that the card previously
//      rendered as two adjacent text boxes. One is a path inside this repo; the
//      other is an arbitrary external address. Exactly one of them is what the
//      open-link button actually opens, and which one is a precedence rule
//      (`documentHref`) nobody could see.
//
// WHAT THIS DELIBERATELY DOES NOT DO: check anything. No HEAD request, no
// existence probe, no "last verified" timestamp — the requirement's own default
// for this session forbids new AWS resources, and a frontend cannot do it at all.
// So the affordance states the ABSENCE of verification rather than implying a
// verification that is not happening. A green tick nobody earned would be worse
// than the silence it replaced.
//
// The `urlRejected` chip is the one genuinely new FACT rather than new framing:
// `documentHref` silently falls back to the constructed blob URL when a stored
// `url` fails the scheme guard, so a row with an unusable URL column has always
// looked exactly like a row with no URL at all.

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import { documentTarget } from './agentRegistryUtils';

const REGISTRATION_NOTE =
    'This row is a REGISTRATION, not the file. Darwin stores a path and a URL and '
    + 'never the contents, never checks that either one resolves, and never deletes '
    + 'a file when the row is deleted. A wrong path is discovered only when an agent '
    + 'fails to read it at boot.';

// `documentUrlError` and `isSafeHref` both let a scheme-less value through on
// purpose — a relative href is same-origin and inert. Calling that "external"
// would be the card stating something false, which is the one thing this row
// exists to stop doing. No live row is in this shape today (all 83 documents
// carry an https URL or none); the branch is here so the label cannot become a
// lie the first time one is.
const isExternalUrl = (url) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test((url || '').trim());

const DocumentTargetChips = ({ document: doc, testIdPrefix }) => {
    const target = documentTarget(doc);
    const { hasLocation, hasUrl, urlRejected, opens } = target;
    const external = isExternalUrl(doc?.url);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5,
                   flexWrap: 'wrap', rowGap: 0.5, mb: 1.5 }}
             data-testid={`${testIdPrefix}-target`}>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.25 }}>
                Points at
            </Typography>
            {/* `role="img"` with the WHOLE note as the label, and no `tabIndex` —
                the same call as CommitModeMarker, for the same reason: a screen
                reader gets the sentence without a tab stop, and adding one per card
                would bury the fields behind non-interactive stops. */}
            <Tooltip title={REGISTRATION_NOTE}>
                <Box component="span"
                     role="img"
                     sx={{ display: 'inline-flex', color: 'text.disabled',
                           cursor: 'help', mr: 0.25 }}
                     aria-label={REGISTRATION_NOTE}
                     data-testid={`${testIdPrefix}-target-help`}>
                    <HelpOutlineIcon sx={{ fontSize: '0.95rem' }} />
                </Box>
            </Tooltip>

            {hasLocation && (
                <Tooltip title={`${doc.location} — a repo-relative path registered here. `
                    + 'Nothing checks that this file exists.'
                    + (opens === 'path'
                        ? ' The open-link button resolves to this, as a GitHub blob URL.'
                        : '')}>
                    <Chip
                        size="small"
                        icon={<DescriptionOutlinedIcon fontSize="small" />}
                        label="repo path"
                        // FILLED means "this is the one the link opens". The
                        // distinction is the whole reason both chips are here: two
                        // outlined chips would say a row points at two places and
                        // leave the precedence rule as invisible as it was before.
                        variant={opens === 'path' ? 'filled' : 'outlined'}
                        color={opens === 'path' ? 'primary' : 'default'}
                        data-testid={`${testIdPrefix}-target-path`}
                        data-opens={opens === 'path' ? '1' : '0'}
                    />
                </Tooltip>
            )}

            {hasUrl && !urlRejected && (
                <Tooltip title={`${doc.url} — ${external
                    ? 'an external address'
                    : 'a same-origin path'} stored verbatim. `
                    + 'It is never fetched and nothing verifies that it resolves.'
                    + (opens === 'url' ? ' The open-link button resolves to this.' : '')}>
                    <Chip
                        size="small"
                        icon={<LinkOutlinedIcon fontSize="small" />}
                        label={external ? 'external URL' : 'stored link'}
                        variant={opens === 'url' ? 'filled' : 'outlined'}
                        color={opens === 'url' ? 'primary' : 'default'}
                        data-testid={`${testIdPrefix}-target-url`}
                        data-opens={opens === 'url' ? '1' : '0'}
                    />
                </Tooltip>
            )}

            {urlRejected && (
                <Tooltip title={`The stored URL ("${doc.url}") is not an http or https `
                    + 'address, so it is never rendered as a link. '
                    + (hasLocation
                        ? 'The open-link button falls back to the repo path.'
                        : 'This row has nothing to open.')}>
                    <Chip
                        size="small"
                        icon={<LinkOffIcon fontSize="small" />}
                        label="URL unusable"
                        color="warning"
                        variant="outlined"
                        data-testid={`${testIdPrefix}-target-url-rejected`}
                    />
                </Tooltip>
            )}

            {!opens && (
                <Tooltip title={'This row registers no usable path or URL, so there is '
                    + 'nothing to open and nothing for an agent to read.'}>
                    <Chip
                        size="small"
                        label="nothing to open"
                        color="error"
                        variant="outlined"
                        data-testid={`${testIdPrefix}-target-none`}
                    />
                </Tooltip>
            )}

            <Tooltip title={'Darwin has never checked that this resolves — there is no '
                + 'existence check anywhere in the system.'}>
                <Typography variant="caption" color="text.disabled"
                            sx={{ cursor: 'help' }}
                            data-testid={`${testIdPrefix}-target-unverified`}>
                    · never verified
                </Typography>
            </Tooltip>
        </Box>
    );
};

export default DocumentTargetChips;
