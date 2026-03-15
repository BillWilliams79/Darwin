import React, { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import ThemeContext from './ThemeContext';
import AuthContext from '../Context/AuthContext';

const STORAGE_KEY = 'darwin-theme';

// Warm charcoal dark palette
const DARK_BG = '#141210';
const DARK_PAPER = '#2a2723';
const DARK_INPUT_BG = '#2a2723';
const DARK_DIVIDER = 'rgba(255,255,255,0.07)';
const DARK_TEXT_PRIMARY = '#e8e1d5';
const DARK_TEXT_SECONDARY = '#9a9186';

// CSS custom properties for non-MUI elements (e.g. .task in index.css)
const setCssVars = (mode) => {
    const root = document.documentElement;
    if (mode === 'dark') {
        root.style.setProperty('--darwin-task-bg', DARK_INPUT_BG);
        root.style.setProperty('--darwin-divider', DARK_DIVIDER);
        root.style.setProperty('--darwin-input-bg', DARK_INPUT_BG);
    } else {
        root.style.setProperty('--darwin-task-bg', 'white');
        root.style.setProperty('--darwin-divider', 'rgba(0,0,0,0.12)');
        root.style.setProperty('--darwin-input-bg', 'white');
    }
};

const ThemeWrapper = ({ children }) => {
    // Read localStorage synchronously to avoid flash
    const [mode, setMode] = useState(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === 'dark' ? 'dark' : 'light';
    });

    const { profile } = useContext(AuthContext);

    // Sync body class and CSS vars when mode changes
    useEffect(() => {
        if (mode === 'dark') {
            document.body.classList.add('darwin-dark');
        } else {
            document.body.classList.remove('darwin-dark');
        }
        setCssVars(mode);
    }, [mode]);

    // Sync from DB profile only when localStorage hasn't been set yet (new device/browser).
    // If localStorage exists, it's the most recent user choice — don't override.
    useEffect(() => {
        if (profile?.theme_mode && !localStorage.getItem(STORAGE_KEY)) {
            setMode(profile.theme_mode);
            localStorage.setItem(STORAGE_KEY, profile.theme_mode);
        }
    }, [profile?.theme_mode]); // eslint-disable-line react-hooks/exhaustive-deps

    const setThemeMode = useCallback((newMode) => {
        setMode(newMode);
        localStorage.setItem(STORAGE_KEY, newMode);
    }, []);

    const theme = useMemo(() => createTheme({
        palette: {
            mode,
            ...(mode === 'dark' && {
                primary: {
                    main: '#90caf9',
                    dark: '#5d99c6',
                    light: '#bbdefb',
                    contrastText: '#141210',
                },
                background: {
                    default: DARK_BG,
                    paper: DARK_PAPER,
                },
                text: {
                    primary: DARK_TEXT_PRIMARY,
                    secondary: DARK_TEXT_SECONDARY,
                },
                divider: DARK_DIVIDER,
            }),
        },
        ...(mode === 'dark' && {
            components: {
                MuiCssBaseline: {
                    styleOverrides: {
                        a: {
                            color: '#90caf9',
                        },
                        'a:visited': {
                            color: '#90caf9',
                        },
                    },
                },
                MuiOutlinedInput: {
                    styleOverrides: {
                        root: {
                            backgroundColor: DARK_INPUT_BG,
                            '& .MuiOutlinedInput-notchedOutline': {
                                borderColor: 'rgba(255,255,255,0.10)',
                            },
                            '&:hover .MuiOutlinedInput-notchedOutline': {
                                borderColor: 'rgba(255,255,255,0.20)',
                            },
                        },
                        input: {
                            color: '#d9d0c4',
                        },
                    },
                },
                MuiPaper: {
                    styleOverrides: {
                        root: {
                            backgroundImage: 'none',
                        },
                    },
                },
                MuiCard: {
                    styleOverrides: {
                        root: {
                            backgroundImage: 'none',
                            borderColor: 'rgba(255,255,255,0.07)',
                        },
                    },
                },
                MuiInputLabel: {
                    styleOverrides: {
                        root: {
                            color: DARK_TEXT_SECONDARY,
                        },
                    },
                },
            },
        }),
    }), [mode]);

    const ctx = useMemo(() => ({ themeMode: mode, setThemeMode }), [mode, setThemeMode]);

    return (
        <ThemeContext.Provider value={ctx}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                {children}
            </ThemeProvider>
        </ThemeContext.Provider>
    );
};

export default ThemeWrapper;
