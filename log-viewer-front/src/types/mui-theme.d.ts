import '@mui/material/styles';

declare module '@mui/material/styles' {
    interface Theme {
        custom?: {
            headerBg?: string;
            sidebarBg?: string;
        };
    }
    interface ThemeOptions {
        custom?: {
            headerBg?: string;
            sidebarBg?: string;
        };
    }
}
