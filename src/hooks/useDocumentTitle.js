// useDocumentTitle.js — name the browser tab after what a page is showing
// (req #3970, first used by the Pipeline visualizer).
//
// The tab reads "Darwin" everywhere (index.html's <title>). A page that calls
// this hook renames it to `title` while it is mounted and the title is
// non-empty, and the effect's CLEANUP puts "Darwin" back — so leaving the page
// by any route (navbar, Back, a link, closing the visualizer) restores the
// default without the page having to enumerate them. Keyed on the title, so a
// rename in place re-titles the tab, and a blank title (loading, not found)
// leaves the default showing.
//
// The default is restored as a constant rather than as "whatever the title was
// before": no other page sets the title, so the snapshot could only ever be
// "Darwin" — or a stale value left by an interleaved effect.

import { useEffect } from 'react';
import { PRODUCT_NAME } from '../config/product';

// req #4076 — the product's name (index.html's <title> is the same value).
export const DEFAULT_DOCUMENT_TITLE = PRODUCT_NAME;

export function useDocumentTitle(title) {
    const text = typeof title === 'string' ? title.trim() : '';
    useEffect(() => {
        if (!text) return undefined;
        document.title = text;
        return () => { document.title = DEFAULT_DOCUMENT_TITLE; };
    }, [text]);
}
