import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import AppStatusBar from '../components/AppStatusBar';
import { useState, useCallback, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { setLogFile } from '../redux/slices/logFileSlice';
import { addFileWithLogs } from '../utils/logDb';
import { detectLogFormat } from '../utils/logFormatDetector';
import { Outlet } from 'react-router-dom';


export default function MainLayout () {
    const [isSidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('sidebarOpen');
        return saved !== null ? saved === 'true' : false;
    });
    const dispatch = useDispatch();
    
    const toggleSidebar = () => {
        setSidebarOpen(prev => {
            const newState = !prev;
            localStorage.setItem('sidebarOpen', String(newState));
            return newState;
        });
    };

    useEffect(() => {
        const preventDefault = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);
        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
        };
    }, []);

    const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const file = e.dataTransfer.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const content = event.target?.result as string;
                const lines = content.split(/\r?\n/);

                // Detect log format
                const format = detectLogFormat(content);


                // Add file with logs to IndexedDB (pass format)
                const fileId = await addFileWithLogs(file.name, file.size, lines, format);

                // Update Redux state
                dispatch(setLogFile({
                    name: file.name,
                    size: file.size,
                    content,
                    format,
                }));

                // Notify UI that a new file was added so it can become active immediately
                try {
                    window.dispatchEvent(new CustomEvent('logviewer:file-added', { detail: { id: fileId } }));
                } catch {
                    // ignore if CustomEvent isn't supported in environment
                }
            };
            reader.readAsText(file);
        }
    }, [dispatch]);

    const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
            }}
            onDrop={onDrop}
            onDragOver={onDragOver}
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
