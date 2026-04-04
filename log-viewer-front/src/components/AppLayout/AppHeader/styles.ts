import type { SxProps, Theme } from '@mui/material/styles';
import { APP_LAYOUT_TOKENS } from '../../../design-tokens';

export const appBarSx: SxProps<Theme> = {
    pl: 0,
    backgroundColor: (theme) => theme.custom?.headerBg,
};

export const toolbarSx: SxProps<Theme> = {
    paddingLeft: '0 !important',
};

export const menuBoxSx: SxProps<Theme> = {
    width: `${APP_LAYOUT_TOKENS.sidebar.collapsedWidth}px`,
    minWidth: `${APP_LAYOUT_TOKENS.sidebar.collapsedWidth}px`,
    maxWidth: `${APP_LAYOUT_TOKENS.sidebar.collapsedWidth}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
};

export const iconButtonSx = (color: string | undefined): SxProps<Theme> => ({
    color,
});

export const titleSx = (color: string | undefined): SxProps<Theme> => ({
    color,
});

export const rightGroupSx: SxProps<Theme> = {
    display: 'flex',
    gap: 2,
};

export const langBoxSx = (color: string | undefined): SxProps<Theme> => ({
    color,
});
