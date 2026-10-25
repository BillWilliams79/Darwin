// A multiline GhostTextField that sits COLLAPSED in a list (req #3572).
//
// The edit-in-place field renders its whole value, which for a 25,000-character
// instruction makes one card taller than the screen and buries the chips and
// counts the card exists to show. This wrapper caps the field at `collapsedRows`
// until the user asks for more, by either of two gestures:
//
//   * CLICKING INTO THE FIELD expands it for as long as it holds focus — nobody
//     edits prose through a four-line slot — and it re-collapses on blur.
//   * THE TOGGLE pins it open (or shut) independently of focus, for reading.
//
// A WRAPPER, NOT A GhostTextField PROP. Nothing here touches the commit contract:
// it only drives `maxRows` and listens to `onEditingChange`, so every guarantee
// GhostTextField documents (revert on reject, no clobber mid-edit, Escape) holds
// unchanged. Clicking into a field just to read it and back out writes nothing,
// because an untouched blur is a no-op there.
//
// The collapse behaviour itself — focus expands, the toggle pins, a pointer
// blur waits for its click, the collapsed textarea has no scrollbar — lives in
// useCollapsibleField, shared with the pipeline card's goal (req #3945).

import Box from '@mui/material/Box';

import CollapseToggle from '../Collapsible/CollapseToggle';
import { useCollapsibleField } from '../Collapsible/useCollapsibleField';
import GhostTextField from './GhostTextField';

const CollapsibleGhostField = ({
    collapsedRows = 4,
    defaultExpanded = false,
    onEditingChange,
    inputRef,
    maxRows,
    sx = {},
    ...fieldProps
}) => {
    const { expanded, toggle, attachInput, setFocused, collapsedSx } =
        useCollapsibleField({ defaultExpanded, inputRef });

    const testId = fieldProps.testId;

    return (
        <Box>
            {/* Always present, above the field (see CollapseToggle). */}
            <CollapseToggle
                expanded={expanded}
                onToggle={toggle}
                testId={testId ? `${testId}-toggle` : undefined}
            />
            <GhostTextField
                {...fieldProps}
                maxRows={expanded ? maxRows : collapsedRows}
                inputRef={attachInput}
                onEditingChange={(on) => {
                    setFocused(on);
                    onEditingChange?.(on);
                }}
                sx={{ ...sx, ...collapsedSx }}
            />
        </Box>
    );
};

export default CollapsibleGhostField;
