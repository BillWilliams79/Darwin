import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanEditorStore } from '../usePlanEditorStore';
import { useRequirementFilerStore } from '../useRequirementFilerStore';
import { AIM_Z, EDITOR_Z, PLAN_EDITOR_Z, FILER_Z } from '../../RequirementFiler/filerHover';

// req #4133 — one plan editor at a time. req #4116 — the Requirement Editor works atop them.
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
    it('opening a plan editor leaves an open Requirement Editor showing', () => {
        useRequirementFilerStore.setState({ editorShow: true });
        usePlanEditorStore.getState().openEditor({ kind: 'epic', target: { id: 1 } });
        expect(useRequirementFilerStore.getState().editorShow).toBe(true);
        expect(usePlanEditorStore.getState().current).not.toBeNull();
    });
    it('showing the Requirement Editor leaves an open plan editor open', () => {
        usePlanEditorStore.getState().openEditor({ kind: 'epic', target: { id: 1 } });
        useRequirementFilerStore.getState().setEditorShow(true);
        expect(usePlanEditorStore.getState().current).not.toBeNull();
        expect(useRequirementFilerStore.getState().editorShow).toBe(true);
    });
    it('does not turn a Requirement Editor draft into a restored one', () => {
        useRequirementFilerStore.setState({ editorShow: true, draft: { title: 'x' }, restoredDraft: false });
        usePlanEditorStore.getState().openEditor({ kind: 'initiative', target: { id: 3 } });
        expect(useRequirementFilerStore.getState().restoredDraft).toBe(false);
    });
    it('stacks the Requirement Editor over a plan editor, both under MUI modals', () => {
        expect(PLAN_EDITOR_Z).toBeGreaterThan(1250); // over the other popups and full screen layers
        expect(PLAN_EDITOR_Z).toBeLessThan(AIM_Z);
        expect(PLAN_EDITOR_Z).toBeLessThan(EDITOR_Z);
        expect(PLAN_EDITOR_Z).toBeLessThan(FILER_Z);
        expect(EDITOR_Z).toBeLessThan(1300);
    });
});
