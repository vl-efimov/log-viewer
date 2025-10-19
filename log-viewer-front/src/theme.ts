
import { createTheme, Theme } from '@mui/material/styles';
import { ColorModeEnum } from './constants/ColorModeEnum';

export const getCustomTheme = (
    mode: ColorModeEnum,
    primary: string,
): Theme => {
    const isLight = mode === ColorModeEnum.Light;
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
export const lightTheme = getCustomTheme(ColorModeEnum.Light, '#6366f1');
export const darkTheme = getCustomTheme(ColorModeEnum.Dark, '#8b5cf6');