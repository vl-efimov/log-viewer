const STATUS_BAR_HEIGHT = 32;

export const APP_LAYOUT_TOKENS = {
    statusBar: {
        height: STATUS_BAR_HEIGHT,
        bg: '#007acc',
        text: '#fff',
        paddingX: 2,
        groupGap: 1,
        dividerHeight: Math.round(STATUS_BAR_HEIGHT * 0.625),
        iconSize: 16,
        iconRaise: 0.2,
        anomalyMaxWidth: 900,
        hoverBg: 'rgba(255, 255, 255, 0.1)',
    },
    sidebar: {
        collapsedWidth: 72,
        expandedWidth: 240,
    },
    header: {
        titleGap: 1,
        fileBadge: {
            borderColor: '#fff',
            paddingX: 1.5,
            paddingY: 0.5,
            gap: 1,
        },
        transitionMs: 300,
    },
} as const;
