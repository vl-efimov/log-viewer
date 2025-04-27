import { useState, useEffect } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeContext } from '../contexts/ThemeContext';
import { ColorModeEnum } from '../constants/ColorModeEnum';
import { darkTheme, lightTheme } from '../theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [mode, setMode] = useState<ColorModeEnum | null>(null);

    useEffect(() => {
        const storedMode = localStorage.getItem('theme');
        const initialMode = storedMode ? (storedMode as ColorModeEnum) : ColorModeEnum.Dark;

        setMode(initialMode);
    }, []);

    if (mode === null) {
        return <div />;
    }

    const toggleTheme = () => {
        const newMode = mode === ColorModeEnum.Light ? ColorModeEnum.Dark : ColorModeEnum.Light;
        setMode(newMode);

        localStorage.setItem('theme', newMode);
    };

    return (
        <ThemeContext.Provider value={{ toggleTheme, mode }}>
            <MuiThemeProvider theme={mode === ColorModeEnum.Dark ? darkTheme : lightTheme}>
                <CssBaseline />
                {children}
            </MuiThemeProvider>
        </ThemeContext.Provider>
    );
}
