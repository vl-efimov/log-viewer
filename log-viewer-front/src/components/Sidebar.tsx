import { Drawer, List, ListItemIcon, ListItemText, Toolbar, Box, ListItemButton, Divider } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PreviewIcon from '@mui/icons-material/Preview';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import PatternIcon from '@mui/icons-material/Pattern';
import SettingsIcon from '@mui/icons-material/Settings';
import React, { useEffect, useState } from 'react';

interface SidebarProps {
    isSidebarOpen: boolean;
}

const menuItems = [
    { text: 'Add new logs', icon: <AddIcon />, divider: true },
    { text: 'Dashboard', icon: <DashboardIcon /> },
    { text: 'View logs', icon: <PreviewIcon />, divider: true },
    { text: 'Anomaly Search', icon: <TroubleshootIcon /> },
    { text: 'Common patterns', icon: <PatternIcon />, divider: true },
    { text: 'Settings', icon: <SettingsIcon /> },
];

const Sidebar: React.FC<SidebarProps> = ({ isSidebarOpen }) => {
    const [isRendered, setIsRendered] = useState(isSidebarOpen);

    useEffect(() => {
        if (isSidebarOpen) {
            setIsRendered(true);
        } else {
            const timeout = setTimeout(() => setIsRendered(false), 300);
            return () => clearTimeout(timeout);
        }
    }, [isSidebarOpen]);

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: isSidebarOpen ? 240 : 70,
                flexShrink: 0,
                transition: 'width 0.3s ease',
                '& .MuiDrawer-paper': {
                    width: isSidebarOpen ? 240 : 70,
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'width 0.3s ease',
                },
            }}
        >
            <Toolbar />
            <Box
                sx={{
                    overflow: 'auto',
                    paddingX: 1,
                }}
            >
                <List>
                    {menuItems.map((item, index) => (
                        <div key={index}>
                            <ListItemButton
                                sx={{
                                    borderRadius: 2,
                                    overflow: 'hidden',
                                    whiteSpace: 'nowrap',
                                    height: '48px',
                                }}
                            >
                                <ListItemIcon>{item.icon}</ListItemIcon>
                                {isRendered && <ListItemText primary={item.text} />}
                            </ListItemButton>
                            {item.divider && <Divider sx={{ marginY: 1 }} />}
                        </div>
                    ))}
                </List>
            </Box>
        </Drawer>
    );
};

export default Sidebar;
