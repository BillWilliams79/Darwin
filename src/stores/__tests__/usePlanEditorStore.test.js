import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanEditorStore } from '../usePlanEditorStore';
import { useRequirementFilerStore } from '../useRequirementFilerStore';

// req #4133 — one editor at a time, across the plan editors and the Requirement Editor.
describe('usePlanEditorStore', () => {
    beforeEach(() => {
        usePlanEditorStore.setState({ current: null });
        useRequirementFilerStore.setState({ editorShow: false });
    });
    it('opening a second plan editor replaces the first, with a fresh key', () => {
        const { openEditor } = usePlanEditorStore.getState();
        openEditor({ kind: 'epic', target: { id: 1 } });
        const k = usePlanEditorStore.getState().current.key;
        openEditor({ kind: 'initiative', target: { id: 2 } });
        const cur = usePlanEditorStore.getState().current;
        expect(cur.kind).toBe('initiative');
        expect(cur.key).toBeGreaterThan(k);
    });
    it('opening a plan editor hides the Requirement Editor', () => {
        useRequirementFilerStore.setState({ editorShow: true });
        usePlanEditorStore.getState().openEditor({ kind: 'epic', target: { id: 1 } });
        expect(useRequirementFilerStore.getState().editorShow).toBe(false);
        expect(usePlanEditorStore.getState().current).not.toBeNull();
    });
    it('showing the Requirement Editor closes a plan editor', () => {
        usePlanEditorStore.getState().openEditor({ kind: 'pipeline', target: { id: 1 } });
        useRequirementFilerStore.getState().setEditorShow(true);
        expect(usePlanEditorStore.getState().current).toBeNull();
    });
});
