import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import React from 'react';

type AppStatusBarItemProps = {
    title: string;
    children: React.ReactNode;
};

const AppStatusBarItem: React.FC<AppStatusBarItemProps> = ({ title, children }) => (
    <Tooltip
        title={title}
        arrow
        placement="top"
    >
        <Box 
            sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1,
                px: 1,
                height: '100%',
                transition: 'background 0.15s',
                cursor: 'default',
                '&:hover': {
                    background: 'rgba(255,255,255,0.1)',
                },
            }}
        >
            {children}
        </Box>
    </Tooltip>
);

export default AppStatusBarItem;