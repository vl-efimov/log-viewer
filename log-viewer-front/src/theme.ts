
import { createTheme, Theme } from '@mui/material/styles';

export const getCustomTheme = (
    mode: 'light' | 'dark',
    primary: string,
): Theme => {
    const isLight = mode === 'light';
    return createTheme({
        palette: {
            mode,
            primary: {
                main: primary,
            },
            secondary: {
                main: isLight ? '#06b6d4' : '#22d3ee',
            },
            background: {
                paper: isLight ? '#fff' : '#23272f',
            },
            text: {
                primary: isLight ? '#1e293b' : '#f1f5f9',
                secondary: isLight ? '#64748b' : '#94a3b8',
            },
            ...(isLight ? {} : { divider: '#334155' }),
        },
        typography: {
            fontFamily: [
                'Inter',
                'Roboto',
                'Helvetica',
                'Arial',
                'sans-serif',
            ].join(','),
        },
    });
};

// For backward compatibility
export const lightTheme = getCustomTheme('light', '#6366f1');
export const darkTheme = getCustomTheme('dark', '#8b5cf6');