import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Toolbar from '@mui/material/Toolbar';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import { useState } from 'react';
import { Outlet } from 'react-router-dom';

export default function MainLayout () {
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const toggleSidebar = () => {
        setSidebarOpen(!isSidebarOpen);
    };

    return (
        <Box 
            sx={{ 
                display: 'flex',
            }}
        >
            <CssBaseline />

            <Header
                isSidebarOpen={isSidebarOpen}
                toggleSidebar={toggleSidebar}
            />
            <Sidebar
                isSidebarOpen={isSidebarOpen}
            />
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                }}
            >
                <Toolbar />
                <Box
                    sx={{
                        p: 3,
                    }}
                >
                    <Outlet />
                </Box>
            </Box>
        </Box>

    );
}
