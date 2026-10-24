// filerScope.jsx — the Requirement Filer always files into PRODUCTION (req #3888).
//
// "Dev Server requirement popup must file real bugs. It must be tied to the
// production server and work with user's credentials so user gets the bugs
// while looking at a dev server." A dev build points AppContext's `darwinUri`
// at `darwin_dev` — the debug database — so until now a requirement filed from
// a dev server landed where nobody would ever see it.
//
// FilerDataScope wraps the filer and its editor. When the page's `darwinUri` is
// not production (`darwinOpsUri`, which always is — req #2697) it re-provides
// AppContext with `darwinUri` pointed at production, so every read and write the
// two popups make — the requirement POST/PUT, its debug-capture row, the
// Project/Category/Machine selects, a reopen — goes to `darwin`, authorised by
// the reader's own Cognito token exactly as on darwin.one. `database` is left as
// the PAGE's: the filed-from record says what the page was showing.
//
// It also gives the popups a QueryClient of their own, because the shared hooks
// key their cache by user, not database: production categories under the same
// key as the page's darwin_dev ones would hand each side the other's rows. The
// debug capture still reads the page's client (debugBundle.js imports it), so it
// records the page, not the filer. In a production build both URIs are already
// `darwin` and the scope adds nothing — the popups share the page's cache, and a
// filed requirement refreshes the requirements pages as before.

import { createContext, useContext, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AppContext from '../Context/AppContext';

/** The popups' own cache when they file somewhere the page does not read. */
export const filerQueryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, gcTime: 600_000, retry: 2 } },
});

const FilesElsewhere = createContext(false);

/** True when the filer files into a database the page is not showing — a dev
 *  build filing into production — so a filed requirement is opened on darwin.one. */
export function useFilerFilesElsewhere() {
    return useContext(FilesElsewhere);
}

export default function FilerDataScope({ children }) {
    const app = useContext(AppContext);
    const elsewhere = !!app.darwinOpsUri && app.darwinUri !== app.darwinOpsUri;
    const scoped = useMemo(() => ({ ...app, darwinUri: app.darwinOpsUri }), [app]);
    if (!elsewhere) return children;
    return (
        <AppContext.Provider value={scoped}>
            <QueryClientProvider client={filerQueryClient}>
                <FilesElsewhere.Provider value={true}>
                    {children}
                </FilesElsewhere.Provider>
            </QueryClientProvider>
        </AppContext.Provider>
    );
}
