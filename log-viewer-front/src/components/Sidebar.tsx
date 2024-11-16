import { Drawer, List, ListItemIcon, ListItemText, Toolbar, Box, ListItemButton, Divider, ListSubheader } from '@mui/material';
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

    const topMenuItems = [
        {
            subheader: 'Start',
            items: [
                { text: 'Add new logs', icon: <AddIcon /> },
            ]
        },
        {
            subheader: 'Main items',
            items: [
                { text: 'Dashboard', icon: <DashboardIcon /> },
                { text: 'View logs', icon: <PreviewIcon /> },
            ]
        },
        {
            subheader: 'Analytics',
            items: [
                { text: 'Anomaly Search', icon: <TroubleshootIcon /> },
                { text: 'Common patterns', icon: <PatternIcon /> },
            ]
        },
    ];

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
                    paddingTop: 1,

                    display: 'flex',
                    justifyContent: 'space-between',
                    flexDirection: 'column',
                    height: '100%',
                }}
            >
                <div>
                    {topMenuItems.map((category, index) => (
                        <div key={`sidebar-category-${index}`}>
                            <List
                                sx={{ paddingY: 0 }}
                                subheader={
                                    <ListSubheader
                                        component="div"
                                        sx={{
                                            lineHeight: '24px',
                                            overflow: 'hidden',
                                            whiteSpace: 'nowrap',
                                            transition: 'height 0.3s ease',
                                            height: isSidebarOpen ? '24px' : '0px',
                                        }}
                                    >
                                        {isRendered && category.subheader}
                                    </ListSubheader>
                                }
                            >
                                {category.items?.map((item, index) => (
                                    <div key={`sidebar-item-${index}`}>
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
                                    </div>
                                ))}
                            </List>
                            {index === topMenuItems.length - 1 || <Divider sx={{ marginY: 1 }} />}
                        </div>
                    ))}
                </div>

                <List>
                    <ListItemButton
                        sx={{
                            borderRadius: 2,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon><SettingsIcon /></ListItemIcon>
                        {isRendered && <ListItemText primary={'Settings'} />}
                    </ListItemButton>
                </List>
            </Box>
        </Drawer>
    );
};

export default Sidebar;
