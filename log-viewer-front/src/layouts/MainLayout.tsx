import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import AppStatusBar from '../components/AppStatusBar';
import { useState } from 'react';
import { Outlet } from 'react-router-dom';


export default function MainLayout () {
    const [isSidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('sidebarOpen');
        return saved !== null ? saved === 'true' : false;
    });
    
    const toggleSidebar = () => {
        setSidebarOpen(prev => {
            const newState = !prev;
            localStorage.setItem('sidebarOpen', String(newState));
            return newState;
        });
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
            }}
        >
            <CssBaseline />

            <Header
                isSidebarOpen={isSidebarOpen}
                toggleSidebar={toggleSidebar}
            />
            <Box 
                sx={{ 
                    display: 'flex', 
                    flexGrow: 1,
                    overflow: 'hidden',
                    pt: { xs: '56px', sm: '64px' },
                }}
            >
                <Sidebar
                    isSidebarOpen={isSidebarOpen}
                />
                <Box
                    component="main"
                    sx={{
                        flexGrow: 1,
                        overflow: 'hidden',
                        display: 'flex',
                        position: 'relative',
                        background: (theme) => 
                            theme.palette.mode === 'light' 
                                ? 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
                                : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                        '&::before': {
                            content: '""',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: (theme) => 
                                theme.palette.mode === 'light'
                                    ? `radial-gradient(circle at 20% 50%, ${theme.palette.primary.main}08 0%, transparent 50%),
                                       radial-gradient(circle at 80% 80%, ${theme.palette.secondary.main}06 0%, transparent 50%)`
                                    : `radial-gradient(circle at 20% 50%, ${theme.palette.primary.main}10 0%, transparent 50%),
                                       radial-gradient(circle at 80% 80%, ${theme.palette.secondary.main}08 0%, transparent 50%)`,
                            pointerEvents: 'none',
                        },
                    }}
                >
                    <Box
                        sx={{
                            p: 2,
                            width: '100%',
                            overflow: 'hidden',
                        }}
                    >
                        <Outlet />
                    </Box>
                </Box>
            </Box>
            <AppStatusBar />
        </Box>
    );
}
