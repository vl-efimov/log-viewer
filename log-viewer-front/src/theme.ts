import { createTheme } from '@mui/material/styles';

export const lightTheme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#1976d2',
        },
        secondary: {
            main: '#dc004e',
        },
    },
});

export const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        background: {
            default: '#0D1117',
            paper: '#161B22',
        },
        primary: {
            main: '#61dafb',
        },
        secondary: {
            main: '#8b949e',
        },
        text: {
            primary: '#c9d1d9',
            secondary: '#8b949e',
        },
        divider: '#30363d',
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