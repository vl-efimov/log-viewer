
import { alpha, createTheme, Theme } from '@mui/material/styles';
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
        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    '*': {
                        scrollbarWidth: 'auto',
                        scrollbarColor: isLight
                            ? `${alpha('#64748b', 0.6)} ${alpha('#e2e8f0', 0.9)}`
                            : `${alpha('#94a3b8', 0.45)} ${alpha('#0f172a', 0.55)}`,
                    },
                    '*::-webkit-scrollbar': {
                        width: '12px',
                        height: '12px',
                    },
                    '*::-webkit-scrollbar-track': {
                        background: isLight ? alpha('#e2e8f0', 0.9) : alpha('#0f172a', 0.55),
                        borderRadius: '8px',
                    },
                    '*::-webkit-scrollbar-thumb': {
                        backgroundColor: isLight ? alpha('#64748b', 0.6) : alpha('#94a3b8', 0.45),
                        borderRadius: '8px',
                        border: isLight
                            ? `2px solid ${alpha('#e2e8f0', 0.9)}`
                            : `2px solid ${alpha('#0f172a', 0.55)}`,
                    },
                    '*::-webkit-scrollbar-thumb:hover': {
                        backgroundColor: isLight ? alpha('#475569', 0.7) : alpha('#94a3b8', 0.55),
                    },
                },
            },
            MuiSlider: {
                styleOverrides: {
                    rail: {
                        height: 6,
                        opacity: 1,
                        backgroundColor: isLight ? alpha('#64748b', 0.25) : alpha('#94a3b8', 0.24),
                    },
                    track: {
                        height: 6,
                        backgroundColor: isLight ? alpha(primary, 0.78) : alpha(primary, 0.56),
                        borderColor: isLight ? alpha(primary, 0.78) : alpha(primary, 0.56),
                    },
                    thumb: {
                        width: 16,
                        height: 16,
                        backgroundColor: isLight ? alpha(primary, 0.9) : alpha(primary, 0.68),
                    },
                },
            },
            MuiDialog: {
                styleOverrides: {
                    paper: {
                        backgroundImage: 'none',
                    },
                },
            },
            MuiTooltip: {
                styleOverrides: {
                    tooltip: {
                        fontSize: '1rem',
                        background: '#23272f',
                    },
                    arrow: {
                        color: '#23272f',
                    },
                },
            },
        },
        custom: {
            headerBg: isLight ? '#334155' : undefined,
            sidebarBg: isLight ? '#e2e8f0' : undefined,
        },
    });
};

// For backward compatibility
export const lightTheme = getCustomTheme(ColorModeEnum.Light, '#6366f1');
export const darkTheme = getCustomTheme(ColorModeEnum.Dark, '#8b5cf6');