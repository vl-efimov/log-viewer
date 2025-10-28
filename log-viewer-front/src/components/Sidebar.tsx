import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import Divider from '@mui/material/Divider';
import ListSubheader from '@mui/material/ListSubheader';
import AddIcon from '@mui/icons-material/Add';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PreviewIcon from '@mui/icons-material/Preview';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import PatternIcon from '@mui/icons-material/Pattern';
import SettingsIcon from '@mui/icons-material/Settings';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RouteAddLogs, RouteDashboard, RouteViewLogs, RouteAnomalySearch, RouteCommonPatterns, RouteSettings } from '../routes/routePaths';

interface SidebarProps {
    isSidebarOpen: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isSidebarOpen }) => {
    const [isRendered, setIsRendered] = useState(isSidebarOpen);
    const location = useLocation();

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
                { text: 'Add new logs', icon: <AddIcon />, path: RouteAddLogs },
            ]
        },
        {
            subheader: 'Main items',
            items: [
                { text: 'Dashboard', icon: <DashboardIcon />, path: RouteDashboard },
                { text: 'View logs', icon: <PreviewIcon />, path: RouteViewLogs },
            ]
        },
        {
            subheader: 'Analytics',
            items: [
                { text: 'Anomaly Search', icon: <TroubleshootIcon />, path: RouteAnomalySearch },
                { text: 'Common patterns', icon: <PatternIcon />, path: RouteCommonPatterns },
            ]
        },
    ];

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: isSidebarOpen ? 240 : 73,
                flexShrink: 0,
                transition: 'width 0.3s ease',
                '& .MuiDrawer-paper': {
                    width: isSidebarOpen ? 240 : 73,
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'width 0.3s ease',
                    position: 'relative',
                    backgroundColor: (theme) => theme.custom?.sidebarBg,
                },
            }}
        >
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
                                            marginBottom: 1,
                                            backgroundColor: 'inherit',
                                        }}
                                    >
                                        {isRendered && category.subheader}
                                    </ListSubheader>
                                }
                            >
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {category.items?.map((item, index) => (
                                        <Box key={`sidebar-item-${index}`}>
                                            <ListItemButton
                                                component={Link}
                                                to={item.path}
                                                selected={location.pathname === item.path}
                                                sx={{
                                                    borderRadius: 2,
                                                    overflow: 'hidden',
                                                    whiteSpace: 'nowrap',
                                                    height: '48px',
                                                }}
                                            >
                                                <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                                                {isRendered && <ListItemText primary={item.text} />}
                                            </ListItemButton>
                                        </Box>
                                    ))}
                                </Box>
                            </List>
                            {index === topMenuItems.length - 1 || <Divider sx={{ marginY: 1 }} />}
                        </div>
                    ))}
                </div>

                <List>
                    <ListItemButton
                        component={Link}
                        to={RouteSettings}
                        selected={location.pathname === RouteSettings}
                        sx={{
                            borderRadius: 2,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 40 }}><SettingsIcon /></ListItemIcon>
                        {isRendered && <ListItemText primary={'Settings'} />}
                    </ListItemButton>
                </List>
            </Box>
        </Drawer>
    );
};

export default Sidebar;
