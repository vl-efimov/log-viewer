import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import React from 'react';
import { APP_LAYOUT_TOKENS } from '../../design-tokens';

const { hoverBg: HOVER_BG } = APP_LAYOUT_TOKENS.statusBar;

type AppStatusBarItemProps = {
    title: React.ReactNode;
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
};

const AppStatusBarItem: React.FC<AppStatusBarItemProps> = ({ title, children, onClick, disabled = false }) => (
    <Tooltip
        title={title}
        arrow
        placement="top"
    >
        <Box 
            role={onClick && !disabled ? 'button' : undefined}
            tabIndex={onClick && !disabled ? 0 : -1}
            onClick={onClick && !disabled ? onClick : undefined}
            onKeyDown={(event) => {
                if (!onClick || disabled) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick();
                }
            }}
            sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1,
                px: 1,
                height: '100%',
                transition: 'background 0.15s',
                cursor: onClick && !disabled ? 'pointer' : 'default',
                opacity: 1,
                '&:hover': onClick && !disabled
                    ? {
                        background: HOVER_BG,
                    }
                    : undefined,
            }}
        >
            {children}
        </Box>
    </Tooltip>
);

export default AppStatusBarItem;