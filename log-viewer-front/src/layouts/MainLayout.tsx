import { Box, Toolbar } from '@mui/material';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import { useState } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';

import AddLogsPage from '../pages/AddLogsPage';
import AnomaliesPage from '../pages/AnomaliesPage';
import CommonPatternsPage from '../pages/CommonPatternsPage';
import DashboardPage from '../pages/DashboardPage';
import SettingsPage from '../pages/SettingsPage';
import ViewLogsPage from '../pages/ViewLogsPage';

export default function MainLayout() {
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const toggleSidebar = () => {
        setSidebarOpen(!isSidebarOpen);
    };

    return (
        <Router>
            <Box sx={{ display: 'flex' }}>
                <Header
                    isSidebarOpen={isSidebarOpen}
                    toggleSidebar={toggleSidebar}
                />
                <Sidebar
                    isSidebarOpen={isSidebarOpen}
                />
                <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
                    <Toolbar />
                    <Routes>
                        <Route path="/add-logs" element={<AddLogsPage />} />
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/view-logs" element={<ViewLogsPage />} />
                        <Route path="/anomaly-search" element={<AnomaliesPage />} />
                        <Route path="/common-patterns" element={<CommonPatternsPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                    </Routes>
                </Box>
            </Box>
        </Router>
    );
}
