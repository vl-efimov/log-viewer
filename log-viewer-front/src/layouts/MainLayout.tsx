import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import AppStatusBar from '../components/AppStatusBar';
import { useState, useCallback, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { setLogFile } from '../redux/slices/logFileSlice';
import { addFileWithLogs } from '../utils/logDb';
import { Outlet } from 'react-router-dom';


export default function MainLayout () {
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const dispatch = useDispatch();
    const toggleSidebar = () => {
        setSidebarOpen(!isSidebarOpen);
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
        if (file && file.type === 'text/plain') {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const content = event.target?.result as string;
                const lines = content.split(/\r?\n/);
                
                // Add file with logs to IndexedDB
                await addFileWithLogs(file.name, file.size, lines);
                
                // Update Redux state
                dispatch(setLogFile({
                    name: file.name,
                    size: file.size,
                    content,
                }));
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
                border: '1px solid red'
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
                    }}
                >
                    <Box
                        sx={{
                            p: 2,
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
