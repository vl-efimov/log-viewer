import { Box } from '@mui/material';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import { useState } from 'react';

export default function MainLayout () {
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const toggleSidebar = () => {
        setSidebarOpen(!isSidebarOpen)
    };

    return (
        <Box sx={{ display: 'flex' }}>
            <Header 
                isSidebarOpen={isSidebarOpen} 
                toggleSidebar={toggleSidebar} 
            />
            <Sidebar 
                isSidebarOpen={isSidebarOpen} 
            />
        </Box>
    );
}