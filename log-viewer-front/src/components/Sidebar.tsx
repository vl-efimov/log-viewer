import { Drawer, List, ListItemIcon, ListItemText, Toolbar, Box, ListItemButton, Divider } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PreviewIcon from '@mui/icons-material/Preview';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import PatternIcon from '@mui/icons-material/Pattern';
import SettingsIcon from '@mui/icons-material/Settings';
import { useEffect, useState } from 'react';

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
                    <ListItemButton
                        sx={{
                            borderRadius: 1,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon>
                            <AddIcon />
                        </ListItemIcon>
                        {isRendered && <ListItemText primary="Add new logs" />}
                    </ListItemButton>
                    <Divider />
                    <ListItemButton
                        sx={{
                            borderRadius: 1,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon>
                            <DashboardIcon />
                        </ListItemIcon>
                        {isRendered && <ListItemText primary="Dashboard" />}
                    </ListItemButton>
                    <ListItemButton
                        sx={{
                            borderRadius: 1,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon>
                            <PreviewIcon />
                        </ListItemIcon>
                        {isRendered && <ListItemText primary="View logs" />}
                    </ListItemButton>
                    <Divider />
                    <ListItemButton
                        sx={{
                            borderRadius: 1,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon>
                            <TroubleshootIcon />
                        </ListItemIcon>
                        {isRendered && <ListItemText primary="Anomaly Search" />}
                    </ListItemButton>
                    <ListItemButton
                        sx={{
                            borderRadius: 1,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon>
                            <PatternIcon />
                        </ListItemIcon>
                        {isRendered && <ListItemText primary="Common patterns" />}
                    </ListItemButton>

                    <Divider />
                    <ListItemButton
                        sx={{
                            borderRadius: 1,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon>
                            <SettingsIcon />
                        </ListItemIcon>
                        {isRendered && <ListItemText primary="Settings" />}
                    </ListItemButton>
                </List>
            </Box>
        </Drawer>
    );
}

export default Sidebar;