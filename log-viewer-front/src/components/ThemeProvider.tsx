import { useState } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeContext } from '../contexts/ThemeContext';
import { ColorModeEnum } from '../constants/ColorModeEnum';
import { darkTheme, lightTheme } from '../theme';

export function ThemeProvider ({ children }: { children: React.ReactNode }) {
    const [mode, setMode] = useState<ColorModeEnum>(ColorModeEnum.Dark);

    const toggleTheme = () => {
        setMode((prev) => (prev === ColorModeEnum.Light ? ColorModeEnum.Dark : ColorModeEnum.Light));
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