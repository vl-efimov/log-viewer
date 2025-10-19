import React, { useState, useEffect } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeContext } from '../contexts/ThemeContext';
import { ColorModeEnum } from '../constants/ColorModeEnum';
import { getCustomTheme } from '../theme';

const DEFAULT_PRIMARY = '#1976d2';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [mode, setMode] = useState<ColorModeEnum | null>(null);
    const [primaryColor, setPrimaryColor] = useState<string>(DEFAULT_PRIMARY);

    useEffect(() => {
        const storedMode = localStorage.getItem('theme');
        const initialMode = (storedMode as ColorModeEnum) || ColorModeEnum.Dark;
        setMode(initialMode);

        const storedPrimary = localStorage.getItem('primaryColor');
        if (storedPrimary) setPrimaryColor(storedPrimary);
    }, []);

    if (mode === null) {
        return <div />;
    }

    const toggleTheme = () => {
        const newMode = mode === ColorModeEnum.Light ? ColorModeEnum.Dark : ColorModeEnum.Light;
        setMode(newMode);
        localStorage.setItem('theme', newMode);
    };

    const handlePrimaryColor = (color: string) => {
        setPrimaryColor(color);
        localStorage.setItem('primaryColor', color);
    };

    const theme = getCustomTheme(mode === ColorModeEnum.Dark ? ColorModeEnum.Dark : ColorModeEnum.Light, primaryColor);

    return (
        <ThemeContext.Provider
            value={{
                toggleTheme,
                mode,
                primaryColor,
                setPrimaryColor: handlePrimaryColor,
            }}
        >
            <MuiThemeProvider theme={theme}>
                <CssBaseline />
                {children}
            </MuiThemeProvider>
        </ThemeContext.Provider>
    );
}
