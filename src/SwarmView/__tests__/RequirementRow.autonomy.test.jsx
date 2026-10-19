// @vitest-environment jsdom
//
// Req #3644 — the row carries no indicator icons. Status and autonomy are SET
// from the row's ⋮ menu, inside the same editable window the retired icons used
// (authoring/approved/swarm_ready — req #3054/#3056), and are shown read-only
// (locked) for every other status. The COLOUR the row wears comes from the
// plan colour key, worn as the TEXT colour of the id and the title; 'none'
// reads in the plan's plain text colour. The title box has NO outline in
// any state (user directive: "Remove all the text box outlines completely").

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

import RequirementRow from '../RequirementRow';
import { RequirementActionsContext } from '../../hooks/useRequirementActions';
import { requirementColorViews, REQ_CARD_THEME } from '../requirementCardTheme';
import { planPalette, DEFAULT_PLAN_PALETTE } from '../pipelines/pipelinePlanLayout';

const noop = () => {};
const AURORA = planPalette(DEFAULT_PLAN_PALETTE);

let roots = [];
function mount(requirement, { colorKey = 'state', coordinationClick = noop, statusClick = noop } = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const colorViews = requirementColorViews({ requirements: [requirement] });
    act(() => {
        root.render(
            <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                <RequirementActionsContext.Provider value={{
                    statusClick, coordinationClick,
                    titleChange: noop, titleKeyDown: noop, titleOnBlur: noop,
                    deleteClick: noop, sessionStatusMap: {}, sortMode: 'created',
                    setCrossCardInsertIndex: noop, requirementsArray: [requirement],
                    setRequirementsArray: noop, colorKey, colorViews,
                }}>
                    <RequirementRow requirement={requirement} requirementIndex={0} />
                </RequirementActionsContext.Provider>
            </DndProvider>
        );
    });
    return container;
}

function openMenu(container) {
    const button = container.querySelector('[data-testid="req-menu-42"]');
    act(() => { button.click(); });
}

afterEach(() => {
    act(() => { roots.forEach((r) => r.unmount()); });
    roots = [];
    document.body.innerHTML = '';
});

const reqWithStatus = (status) => ({
    id: 42, title: 'Test requirement', requirement_status: status,
    coordination_type: 'implemented', category_fk: 5, sort_order: 0,
});

// The value of `prop` that THIS row's title field emits for its input text.
// Scoped by the field's own emotion class, because emotion's <style> tags
// outlive each test's unmount.
function titleTextRule(container, prop) {
    const field = container.querySelector('[data-testid="req-title-42"]');
    const classes = [...field.classList].filter((c) => c.startsWith('css-'));
    const rule = [...document.querySelectorAll('style')]
        .flatMap((st) => [...st.sheet.cssRules])
        .find((r) => classes.some((c) => r.selectorText === `.${c} .MuiInputBase-input`));
    return rule?.style.getPropertyValue(prop);
}

const ALL_STATUSES = ['authoring', 'approved', 'swarm_ready', 'development', 'met', 'wontfix', 'deferred'];
const EDITABLE_STATUSES = ['authoring', 'approved', 'swarm_ready'];

describe('RequirementRow — no indicator columns (req #3644)', () => {
    it('renders no status/autonomy/model/effort icon cells', () => {
        const container = mount(reqWithStatus('swarm_ready'));
        for (const id of ['status-toggle-42', 'coordination-toggle-42', 'model-cell-42', 'effort-cell-42']) {
            expect(container.querySelector(`[data-testid="${id}"]`)).toBeNull();
        }
    });
});

describe('RequirementRow ⋮ menu — status and autonomy (req #3644)', () => {
    it.each(ALL_STATUSES)('status=%s: menu offers autonomy, editable only pre-launch', (status) => {
        const container = mount(reqWithStatus(status));
        openMenu(container);
        const editable = EDITABLE_STATUSES.includes(status);
        for (const v of ['discuss', 'planned', 'implemented', 'deployed']) {
            const item = document.querySelector(`[data-testid="req-autonomy-42-${v}"]`);
            expect(item).not.toBeNull();
            expect(item.getAttribute('aria-disabled') === 'true').toBe(!editable);
        }
        for (const v of EDITABLE_STATUSES) {
            const item = document.querySelector(`[data-testid="req-status-42-${v}"]`);
            expect(item.getAttribute('aria-disabled') === 'true').toBe(!editable);
        }
    });

    it('a menu choice sets the value directly', () => {
        const coordinationClick = vi.fn();
        const statusClick = vi.fn();
        const container = mount(reqWithStatus('approved'), { coordinationClick, statusClick });
        openMenu(container);
        act(() => { document.querySelector('[data-testid="req-autonomy-42-deployed"]').click(); });
        expect(coordinationClick).toHaveBeenCalledWith(0, 42, 'deployed');
        openMenu(container);
        act(() => { document.querySelector('[data-testid="req-status-42-authoring"]').click(); });
        expect(statusClick).toHaveBeenCalledWith(0, 42, 'authoring');
    });

    it('choosing the current value writes nothing', () => {
        const coordinationClick = vi.fn();
        const container = mount(reqWithStatus('approved'), { coordinationClick });
        openMenu(container);
        act(() => { document.querySelector('[data-testid="req-autonomy-42-implemented"]').click(); });
        expect(coordinationClick).not.toHaveBeenCalled();
    });
});

describe('RequirementRow colour key (req #3644)', () => {
    it('State colours the id text and the title text', () => {
        const container = mount(reqWithStatus('swarm_ready'), { colorKey: 'state' });
        expect(container.querySelector('[data-testid="req-id-chip-42"]').dataset.keyColor)
            .toBe(AURORA.status.swarm_ready);
        expect(titleTextRule(container, '-webkit-text-fill-color')).toBe(AURORA.status.swarm_ready);
        expect(titleTextRule(container, 'color')).toBe(AURORA.status.swarm_ready);
    });

    it('Autonomy colours the text by coordination type', () => {
        const container = mount(reqWithStatus('approved'), { colorKey: 'autonomy' });
        expect(container.querySelector('[data-testid="req-id-chip-42"]').dataset.keyColor)
            .toBe(AURORA.autonomy.implemented);
        expect(titleTextRule(container, '-webkit-text-fill-color')).toBe(AURORA.autonomy.implemented);
    });

    it("'none' reads in the plan's plain text colour", () => {
        const container = mount(reqWithStatus('approved'), { colorKey: 'none' });
        expect(container.querySelector('[data-testid="req-id-chip-42"]').dataset.keyColor)
            .toBe(REQ_CARD_THEME.text);
        expect(titleTextRule(container, '-webkit-text-fill-color')).toBe(REQ_CARD_THEME.text);
    });

    it('draws no stripe on the title box', () => {
        const container = mount(reqWithStatus('swarm_ready'), { colorKey: 'state' });
        const field = container.querySelector('[data-testid="req-title-42"]');
        const classes = [...field.classList].filter((c) => c.startsWith('css-'));
        const shadow = [...document.querySelectorAll('style')]
            .flatMap((st) => [...st.sheet.cssRules])
            .find((r) => classes.some((c) => r.selectorText?.startsWith(`.${c} `))
                && (r.style?.getPropertyValue('box-shadow') || '').startsWith('inset'));
        expect(shadow).toBeUndefined();
    });
});

describe('RequirementRow title box (req #3644 review)', () => {
    it.each([['keyed', 'state', false], ['unkeyed', 'none', false], ['orchestrated', 'state', true]])(
        'draws no outline (%s)', (_label, colorKey, orchestrated) => {
            const requirement = reqWithStatus('swarm_ready');
            const container = document.createElement('div');
            document.body.appendChild(container);
            const root = createRoot(container);
            roots.push(root);
            act(() => {
                root.render(
                    <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
                        <RequirementActionsContext.Provider value={{
                            statusClick: noop, coordinationClick: noop,
                            titleChange: noop, titleKeyDown: noop, titleOnBlur: noop,
                            deleteClick: noop, sessionStatusMap: {}, sortMode: 'created',
                            setCrossCardInsertIndex: noop, requirementsArray: [requirement],
                            setRequirementsArray: noop, colorKey,
                            colorViews: requirementColorViews({ requirements: [requirement] }),
                            orchestratedIds: orchestrated ? new Set([42]) : new Set(),
                        }}>
                            <RequirementRow requirement={requirement} requirementIndex={0} />
                        </RequirementActionsContext.Provider>
                    </DndProvider>
                );
            });
            const fieldset = container.querySelector(
                '[data-testid="req-title-42"] .MuiOutlinedInput-notchedOutline');
            expect(fieldset).not.toBeNull();
            // Assert the EMITTED rule, not `getComputedStyle`: jsdom's cascade is
            // insertion-order only and ignores specificity, so it can report
            // MUI's one-class 1px base rule over this three-class override that a
            // browser applies. Every state the row styles must zero the width.
            const rules = [...document.querySelectorAll('style')]
                .flatMap((st) => [...st.sheet.cssRules])
                .filter((r) => r.selectorText
                    && r.selectorText.includes('.MuiOutlinedInput-notchedOutline')
                    && (() => { try { return fieldset.closest('.MuiTextField-root')
                        .matches(r.selectorText.split(' ')[0]); } catch { return false; } })());
            const widthBy = (state) => rules.find((r) => r.selectorText.endsWith(
                `.MuiOutlinedInput-root${state} .MuiOutlinedInput-notchedOutline`))?.style.getPropertyValue('border-width');
            for (const state of ['', ':hover', '.Mui-focused', '.Mui-disabled']) {
                expect(['0', '0px']).toContain(widthBy(state));
            }
        });
});
