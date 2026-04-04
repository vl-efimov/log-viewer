import type { SxProps, Theme } from '@mui/material/styles';
import { APP_LAYOUT_TOKENS } from '../../../design-tokens';

const {
    height: STATUS_BAR_HEIGHT,
    bg: STATUS_BAR_BG,
    text: STATUS_BAR_TEXT,
    paddingX: STATUS_BAR_PADDING_X,
    groupGap: GROUP_GAP,
    dividerHeight: DIVIDER_HEIGHT,
    iconSize: ICON_SIZE,
    iconRaise: ICON_RAISE,
    anomalyMaxWidth: ANOMALY_MAX_WIDTH,
    hoverBg: HOVER_BG,
} = APP_LAYOUT_TOKENS.statusBar;

export const statusBarSx: SxProps<Theme> = {
    height: STATUS_BAR_HEIGHT,
    bgcolor: STATUS_BAR_BG,
    color: STATUS_BAR_TEXT,
    display: 'flex',
    justifyContent: 'space-between',
    px: STATUS_BAR_PADDING_X,
};

export const statusBarLeftGroupSx: SxProps<Theme> = {
    display: 'flex',
    alignItems: 'center',
    gap: GROUP_GAP,
};

export const statusBarDividerSx: SxProps<Theme> = {
    bgcolor: STATUS_BAR_TEXT,
    height: DIVIDER_HEIGHT,
    alignSelf: 'center',
};

export const statusBarIconSx: SxProps<Theme> = {
    fontSize: ICON_SIZE,
};

export const iconRaisedSx: SxProps<Theme> = {
    ...statusBarIconSx,
    marginBottom: ICON_RAISE,
};

export const textSx: SxProps<Theme> = {
    color: STATUS_BAR_TEXT,
};

export const anomalyTextSx: SxProps<Theme> = {
    ...textSx,
    maxWidth: ANOMALY_MAX_WIDTH,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
};

export const closeButtonSx: SxProps<Theme> = {
    color: STATUS_BAR_TEXT,
    '&:hover': {
        bgcolor: HOVER_BG,
    },
};
