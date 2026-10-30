// @vitest-environment jsdom
//
// req #3972 — the Pipeline group view's own edges: a plan's read becomes a
// drawn / loading / failed / empty plan, and a browser without WebGL gets a
// plain explanation rather than a blank stage. The 3D drawing itself needs a
// real WebGL context and is verified in the browser.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PipelineGroupView, { planForGroup } from '../PipelineGroupView';
import AuthContext from '../../Context/AuthContext';
import AppContext from '../../Context/AppContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pipeline = { id: 7, title: 'Plan Seven', pipeline_status: 'orchestrating' };

describe('planForGroup', () => {
    it('names the read state of a plan that is not drawable', () => {
        expect(planForGroup(pipeline, { isLoading: true }, [], new Date()).state).toBe('loading');
        expect(planForGroup(pipeline, { isError: true }, [], new Date()).state).toBe('error');
        expect(planForGroup(pipeline, { data: null }, [], new Date()).state).toBe('empty');
    });

    it('a payload the adapter cannot read is a failed plan, not a crash', () => {
        expect(planForGroup(pipeline, { data: { pipeline: {} } }, [], new Date()).state)
            .toMatch(/error|empty/);
    });
});

describe('PipelineGroupView without WebGL', () => {
    let root;
    afterEach(() => {
        act(() => root?.unmount());
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('explains itself instead of drawing an empty stage', () => {
        // jsdom has no WebGL: getContext answers null, as a browser with it off does.
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <AppContext.Provider value={{ darwinUri: 'http://test.local/darwin' }}>
                        <AuthContext.Provider value={{ idToken: 'tok' }}>
                            <PipelineGroupView pipelines={[pipeline]} onFocusChange={() => {}}
                                               onOpen={() => {}} />
                        </AuthContext.Provider>
                    </AppContext.Provider>
                </QueryClientProvider>,
            );
        });
        expect(document.querySelector('[data-testid="pipelines-group-unsupported"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="pipelines-group-stage"]')).toBeNull();
    });
});
