import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { RouteHome } from '../routes/routePaths';
import { RootState } from '../redux/store';
import { updateLogContent, appendLogContent, setMonitoringState } from '../redux/slices/logFileSlice';
import { getFileHandle } from '../redux/slices/logFileSlice';


const ViewLogsPage: React.FC = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    
    // Get data from Redux
    const { content, name: fileName, isMonitoring, hasFileHandle, size: fileSize } = useSelector((state: RootState) => state.logFile);
    
    const [lines, setLines] = useState<string[]>([]);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [newLinesCount, setNewLinesCount] = useState<number>(0);
    const lastModifiedRef = useRef<number>(0);
    const lastSizeRef = useRef<number>(0);
    const previousLineCountRef = useRef<number>(0);

    // Load initial content from Redux
    useEffect(() => {
        if (content) {
            const newLines = content.split(/\r?\n/);
            const lineCountDiff = newLines.length - previousLineCountRef.current;
            
            setLines(newLines);
            setLastUpdate(new Date());
            
            // Track new lines added
            if (previousLineCountRef.current > 0 && lineCountDiff > 0) {
                setNewLinesCount(lineCountDiff);
                // Reset counter after 3 seconds
                setTimeout(() => setNewLinesCount(0), 3000);
            }
            
            previousLineCountRef.current = newLines.length;
            // Initialize last size for incremental reading
            lastSizeRef.current = fileSize;
        }
    }, [content, fileSize]);

    // Poll for file changes using File System Access API with incremental reading
    useEffect(() => {
        if (!isMonitoring || !autoRefresh || !hasFileHandle) return;

        const fileHandle = getFileHandle();
        if (!fileHandle) return;

        let intervalId: number | null = null;

        const startPolling = async () => {
            try {
                // Read initial state
                const file = await fileHandle.getFile();
                lastModifiedRef.current = file.lastModified;
                lastSizeRef.current = file.size;

                // Start polling for changes
                intervalId = window.setInterval(async () => {
                    try {
                        const file = await fileHandle.getFile();
                        
                        // Check if file was modified
                        if (file.lastModified > lastModifiedRef.current) {
                            lastModifiedRef.current = file.lastModified;
                            const currentSize = file.size;

                            // Check if file was truncated (size decreased) - full reload needed
                            if (currentSize < lastSizeRef.current) {
                                console.log('File truncated, performing full reload');
                                const fullContent = await file.text();
                                
                                dispatch(updateLogContent({
                                    content: fullContent,
                                    lastModified: file.lastModified,
                                }));
                                
                                lastSizeRef.current = currentSize;
                                setLastUpdate(new Date());
                            }
                            // File grew - read only new content (incremental)
                            else if (currentSize > lastSizeRef.current) {
                                console.log(`File grew from ${lastSizeRef.current} to ${currentSize} bytes, reading increment`);
                                
                                // Read only the new part
                                const blob = await file.slice(lastSizeRef.current, currentSize).text();
                                
                                dispatch(appendLogContent({
                                    newContent: blob,
                                    newSize: currentSize,
                                    lastModified: file.lastModified,
                                }));
                                
                                lastSizeRef.current = currentSize;
                                setLastUpdate(new Date());
                            }
                            // Size same but modified timestamp changed - probably same content, skip
                            else {
                                console.log('File modified but size unchanged, skipping update');
                            }
                        }
                    } catch (error) {
                        console.error('Error reading file:', error);
                    }
                }, 1000); // Check every second

            } catch (error) {
                console.error('Error starting file monitoring:', error);
            }
        };

        startPolling();

        return () => {
            if (intervalId !== null) {
                window.clearInterval(intervalId);
            }
        };
    }, [isMonitoring, autoRefresh, hasFileHandle, dispatch]);

    const handleToggleAutoRefresh = () => {
        setAutoRefresh(prev => !prev);
    };

    const handleManualRefresh = async () => {
        const fileHandle = getFileHandle();
        if (!fileHandle) return;

        try {
            const file = await fileHandle.getFile();
            lastModifiedRef.current = file.lastModified;
            const newContent = await file.text();
            
            dispatch(updateLogContent({
                content: newContent,
                lastModified: file.lastModified,
            }));
            
            setLastUpdate(new Date());
        } catch (error) {
            console.error('Error refreshing file:', error);
        }
    };

    const handleReloadFile = () => {
        // Stop current monitoring and navigate back to home to select a new file
        dispatch(setMonitoringState(false));
        navigate(RouteHome);
    };

    const handleBackToHome = () => {
        navigate(RouteHome);
    };

    if (!isMonitoring) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    gap: 2,
                }}
            >
                <Typography variant="h5" gutterBottom>
                    No file selected
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Please select a log file from the Home page to start monitoring.
                </Typography>
                <Typography
                    variant="body2"
                    color="primary"
                    sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={handleBackToHome}
                >
                    Go to Home
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                gap: 2,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                    <Typography variant="h6">
                        {fileName}
                    </Typography>
                    {lastUpdate && (
                        <Typography variant="caption" color="text.secondary">
                            Last updated: {lastUpdate.toLocaleTimeString()}
                        </Typography>
                    )}
                </Box>
            </Box>

            <Alert severity="info" sx={{ mb: 1 }}>
                <Typography variant="body2">
                    <strong>Live Monitoring (Incremental Mode):</strong> 
                    {hasFileHandle ? (
                        <> The file is checked every second. Only new content is read for better performance.</>
                    ) : (
                        <> Automatic updates are not available. Use "Refresh Now" button to manually reload the file.</>
                    )}
                </Typography>
            </Alert>

            <Box sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={handleReloadFile}
                >
                    Change File
                </Typography>
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={handleManualRefresh}
                >
                    Refresh Now
                </Typography>
                <Chip 
                    label={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                    color={autoRefresh ? 'success' : 'default'}
                    onClick={handleToggleAutoRefresh}
                    size="small"
                    sx={{ cursor: 'pointer' }}
                />
                <Typography variant="caption" color="text.secondary">
                    Total lines: {lines.length}
                </Typography>
                {newLinesCount > 0 && (
                    <Chip 
                        label={`+${newLinesCount} new`}
                        color="success"
                        size="small"
                        variant="outlined"
                        sx={{ 
                            animation: 'pulse 0.5s ease-in-out',
                            '@keyframes pulse': {
                                '0%': { transform: 'scale(1)' },
                                '50%': { transform: 'scale(1.1)' },
                                '100%': { transform: 'scale(1)' },
                            }
                        }}
                    />
                )}
            </Box>

            <Paper
                sx={{
                    p: 2,
                    flexGrow: 1,
                    overflow: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f5f5f5',
                }}
            >
                {lines.map((line, i) => (
                    <Box
                        key={i}
                        sx={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            '&:hover': {
                                backgroundColor: (theme) => 
                                    theme.palette.mode === 'dark' 
                                        ? 'rgba(255, 255, 255, 0.05)' 
                                        : 'rgba(0, 0, 0, 0.02)',
                            }
                        }}
                    >
                        <Typography
                            component="span"
                            sx={{
                                color: 'text.secondary',
                                fontSize: '0.75rem',
                                mr: 2,
                                userSelect: 'none',
                            }}
                        >
                            {i + 1}
                        </Typography>
                        {line}
                    </Box>
                ))}
            </Paper>
        </Box>
    );
}

export default ViewLogsPage;