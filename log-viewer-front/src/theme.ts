import { createTheme } from '@mui/material/styles';


export const lightTheme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#6366f1',
        },
        secondary: {
            main: '#06b6d4',
        },
        background: {
            default: '#f8fafc',
            paper: '#fff',
        },
        text: {
            primary: '#1e293b',
            secondary: '#64748b',
        },
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

export const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#8b5cf6',
        },
        secondary: {
            main: '#22d3ee',
        },
        background: {
            default: '#18181b',
            paper: '#23272f',
        },
        text: {
            primary: '#f1f5f9',
            secondary: '#94a3b8',
        },
        divider: '#334155',
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