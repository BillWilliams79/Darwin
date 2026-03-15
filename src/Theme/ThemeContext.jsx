import { createContext } from 'react';

const ThemeContext = createContext({
    themeMode: 'light',
    setThemeMode: () => {},
});

export default ThemeContext;
