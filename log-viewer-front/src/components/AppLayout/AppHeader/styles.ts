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

export const headerLeftSx = (isSidebarOpen: boolean): SxProps<Theme> => ({
    display: 'flex',
    alignItems: 'center',
    width: isSidebarOpen
        ? APP_LAYOUT_TOKENS.sidebar.expandedWidth
        : APP_LAYOUT_TOKENS.sidebar.collapsedWidth,
    transition: `width ${APP_LAYOUT_TOKENS.header.transitionMs}ms ease`,
    overflow: 'hidden',
});

export const titleRowSx: SxProps<Theme> = {
    display: 'flex',
    justifyContent: 'space-between',
    width: '100%',
    gap: APP_LAYOUT_TOKENS.header.titleGap,
};

export const fileBadgeWrapSx: SxProps<Theme> = {
    display: 'flex',
    alignItems: 'center',
    flexGrow: 1,
};

export const fileBadgeSx: SxProps<Theme> = {
    display: 'flex',
    alignItems: 'center',
    border: '1px solid',
    borderColor: APP_LAYOUT_TOKENS.header.fileBadge.borderColor,
    px: APP_LAYOUT_TOKENS.header.fileBadge.paddingX,
    py: APP_LAYOUT_TOKENS.header.fileBadge.paddingY,
    gap: APP_LAYOUT_TOKENS.header.fileBadge.gap,
    bgcolor: 'transparent',
};

export const fileClearButtonSx = (color: string | undefined): SxProps<Theme> => ({
    ...iconButtonSx(color),
    p: 0.5,
});

export const fileBadgeSpacerSx: SxProps<Theme> = {
    flexGrow: 1,
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
