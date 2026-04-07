import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Header from './AppHeader/AppHeader';
import Sidebar from './AppSidebar/AppSidebar';
import AppStatusBar from './AppStatusBar/AppStatusBar';
import { useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useFileLoader } from '../../hooks/useFileLoader';


export default function MainLayout () {
    const [isSidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('sidebarOpen');
        return saved !== null ? saved === 'true' : false;
    });
    const [isDragActive, setIsDragActive] = useState(false);
    const dragCounterRef = useRef(0);
    const { handleFileDrop } = useFileLoader();
    
    const toggleSidebar = () => {
        setSidebarOpen(prev => {
            const newState = !prev;
            localStorage.setItem('sidebarOpen', String(newState));
            return newState;
        });
    };

    const shouldHandleDrag = (event: React.DragEvent<HTMLDivElement>) => {
        return Array.from(event.dataTransfer.types).includes('Files');
    };

    const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
        if (!shouldHandleDrag(event)) return;
        event.preventDefault();
        dragCounterRef.current += 1;
        setIsDragActive(true);
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        if (!shouldHandleDrag(event)) return;
        event.preventDefault();
    };

    const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        if (!shouldHandleDrag(event)) return;
        event.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
            setIsDragActive(false);
        }
    };

    const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        if (!shouldHandleDrag(event)) return;
        event.preventDefault();
        dragCounterRef.current = 0;
        setIsDragActive(false);
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        await handleFileDrop(file);
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
            }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
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
                            overflow: 'auto',
                        }}
                    >
                        <Outlet />
                    </Box>
                </Box>
            </Box>
            <AppStatusBar />
            {isDragActive && (
                <Box
                    sx={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 1400,
                        backgroundColor: 'rgba(15, 23, 42, 0.35)',
                        border: '2px dashed rgba(59, 130, 246, 0.85)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                        backdropFilter: 'blur(2px)',
                        color: '#f8fafc',
                        fontSize: 20,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                    }}
                >
                    Drop log file to open
                </Box>
            )}
        </Box>
    );
}
