import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import Divider from '@mui/material/Divider';
import ListSubheader from '@mui/material/ListSubheader';
import PreviewIcon from '@mui/icons-material/Preview';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DescriptionIcon from '@mui/icons-material/Description';
import ModelTrainingIcon from '@mui/icons-material/ModelTraining';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RouteDashboard, RouteViewLogs, RouteLogFormats, RoutePretrainedModels, RouteSettings } from '../../routes/routePaths';
import { RouteAbout } from '../../routes/routePaths';
import { baseUrl } from '../../constants/BaseUrl';
import { APP_LAYOUT_TOKENS } from '../../design-tokens';

interface SidebarProps {
    isSidebarOpen: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isSidebarOpen }) => {
    const [isRendered, setIsRendered] = useState(isSidebarOpen);
    const location = useLocation();
    const { t } = useTranslation();

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
            subheader: t('sidebar.groups.logs'),
            items: [
                { text: t('sidebar.items.viewLogs'), icon: <PreviewIcon />, path: RouteViewLogs },
                { text: t('sidebar.items.dashboard'), icon: <DashboardIcon />, path: RouteDashboard },
            ]
        },
        {
            subheader: t('sidebar.groups.resources'),
            items: [
                { text: t('sidebar.items.logFormats'), icon: <DescriptionIcon />, path: RouteLogFormats },
                { text: t('sidebar.items.pretrainedModels'), icon: <ModelTrainingIcon />, path: RoutePretrainedModels },
            ]
        },
    ];

    const isSelected = (path: string): boolean => {
        const fullPath = `${baseUrl}${path}`.replace(/\//g, '/');
        return location.pathname === fullPath || location.pathname === fullPath.replace(/\/$/, '');
    };

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: isSidebarOpen
                    ? APP_LAYOUT_TOKENS.sidebar.expandedWidth
                    : APP_LAYOUT_TOKENS.sidebar.collapsedWidth,
                flexShrink: 0,
                transition: 'width 0.3s ease',
                '& .MuiDrawer-paper': {
                    width: isSidebarOpen
                        ? APP_LAYOUT_TOKENS.sidebar.expandedWidth
                        : APP_LAYOUT_TOKENS.sidebar.collapsedWidth,
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
                                                selected={isSelected(item.path)}
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
                        to={RouteAbout}
                        selected={isSelected(RouteAbout)}
                        sx={{
                            borderRadius: 2,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 40 }}><InfoOutlinedIcon /></ListItemIcon>
                        {isRendered && <ListItemText primary={t('sidebar.items.about')} />}
                    </ListItemButton>
                    <Divider sx={{ marginY: 1 }} />
                    <ListItemButton
                        component={Link}
                        to={RouteSettings}
                        selected={isSelected(RouteSettings)}
                        sx={{
                            borderRadius: 2,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            height: '48px',
                        }}
                    >
                        <ListItemIcon sx={{ minWidth: 40 }}><SettingsIcon /></ListItemIcon>
                        {isRendered && <ListItemText primary={t('sidebar.items.settings')} />}
                    </ListItemButton>
                </List>
            </Box>
        </Drawer>
    );
};

export default Sidebar;
