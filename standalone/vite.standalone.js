// vite.standalone.js — backend-free static build of the Darwin Build
// Visualizer (req #2743).
//
// Builds the REAL src/BuildVisualizer/* React app into a single self-contained
// index.html (vite-plugin-singlefile inlines all JS+CSS — no separate .js
// chunks, so nothing for Gmail to block and it runs over file://).
//
// resolve.alias swaps the five cross-cutting modules the subtree imports for
// standalone stubs, leaving the BuildVisualizer source byte-identical to
// Darwin's (zero drift). The specifiers below are exactly what
// src/BuildVisualizer/{BuildVisualizerPage.jsx,useBuildPatterns.js,useBuildVisualizerData.js}
// import.
//
// Build:  cd Darwin && npx vite build --config standalone/vite.standalone.js
// Output: Darwin/dist-standalone/index.html
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

const here = import.meta.dirname;
const stub = (f) => path.resolve(here, f);

export default defineConfig({
    root: here,
    base: './',
    define: { global: 'globalThis' },
    plugins: [react(), viteSingleFile()],
    resolve: {
        alias: [
            { find: '../RestApi/RestApi', replacement: stub('standaloneApi.js') },
            { find: '../hooks/factory/createEntityQueries', replacement: stub('standaloneApi.js') },
            { find: '../Context/AppContext', replacement: stub('stubAppContext.js') },
            { find: '../Context/AuthContext', replacement: stub('stubAuthContext.js') },
            { find: '../Theme/ThemeContext', replacement: stub('stubThemeContext.js') },
        ],
    },
    build: {
        outDir: path.resolve(here, '../dist-standalone'),
        emptyOutDir: true,
        // Belt-and-suspenders with viteSingleFile: keep everything in one chunk.
        chunkSizeWarningLimit: 4096,
    },
});
