// Standalone Build Visualizer entry (req #2743).
//
// Mounts the REAL Darwin BuildVisualizerPage (src/BuildVisualizer/*) with the
// data layer + contexts swapped via vite.standalone.js resolve.alias. Same
// component Darwin runs → true visual + behavioral parity, no backend.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import BuildVisualizerPage from '../src/BuildVisualizer/BuildVisualizerPage';

const theme = createTheme({ palette: { mode: 'dark' } });

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            refetchOnWindowFocus: false,
            // localStorage round-trips are instant — never serve stale.
            staleTime: 0,
        },
    },
});

createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <BuildVisualizerPage />
            </ThemeProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
