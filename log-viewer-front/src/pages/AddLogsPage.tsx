import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CircularProgress from '@mui/material/CircularProgress';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { RouteViewLogs } from '../routes/routePaths';
import { setLogFile, setMonitoringState, setFileHandle, setLazyReader } from '../redux/slices/logFileSlice';
import { RootState } from '../redux/store';
import { detectLogFormat } from '../utils/logFormatDetector';
import { LazyFileReader } from '../utils/lazyFileReader';

const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB

const AddLogsPage: React.FC = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const isMonitoring = useSelector((state: RootState) => state.logFile.isMonitoring);
    const fileName = useSelector((state: RootState) => state.logFile.name);
    const [indexing, setIndexing] = useState(false);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Read initial content
        const content = await file.text();
        
        // Detect log format
        const detectedFormat = detectLogFormat(content);
        
        // Store in Redux
        dispatch(setLogFile({
            name: file.name,
            size: file.size,
            content: content,
            format: detectedFormat || 'Unknown',
            lastModified: file.lastModified,
            hasFileHandle: false, // Regular file input doesn't give us a handle
        }));
        
        dispatch(setMonitoringState(true));
        
        // Navigate to view page after short delay
        setTimeout(() => {
            navigate(RouteViewLogs);
        }, 300);
    };

    const handleSelectWithFSA = async () => {
        // Try to use File System Access API for better monitoring
        if ('showOpenFilePicker' in window) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const [handle] = await (window as any).showOpenFilePicker({
                    types: [
                        {
                            description: 'Log Files',
                            accept: {
                                'text/plain': ['.txt', '.log'],
                                'application/json': ['.json'],
                            },
                        },
                    ],
                    multiple: false,
                });

                const file = await handle.getFile();
                console.log('File size:', file.size);
                
                // Use lazy loading for large files
                const useLazy = file.size > LARGE_FILE_THRESHOLD;
                
                if (useLazy) {
                    console.log('Large file detected, using lazy loading');
                    setIndexing(true);
                    
                    // Create lazy reader and build index
                    const lazyReader = new LazyFileReader(file);
                    await lazyReader.buildIndex();
                    
                    const totalLines = lazyReader.getTotalLines();
                    console.log('Indexed lines:', totalLines);
                    
                    // Read first 1000 lines to detect format
                    const firstLines = await lazyReader.readLines(1, Math.min(1000, totalLines));
                    const sampleContent = firstLines.map(l => l.content).join('\n');
                    const detectedFormat = detectLogFormat(sampleContent);
                    
                    // Store the handle and lazy reader globally
                    setFileHandle(handle);
                    setLazyReader(lazyReader);
                    
                    // Store file info in Redux (no full content)
                    dispatch(setLogFile({
                        name: file.name,
                        size: file.size,
                        content: '', // Empty for lazy loading
                        format: detectedFormat || 'Unknown',
                        lastModified: file.lastModified,
                        hasFileHandle: true,
                        totalLines: totalLines,
                        useLazyLoading: true,
                    }));
                    
                    setIndexing(false);
                } else {
                    console.log('Small file, loading fully');
                    const content = await file.text();

                    // Detect log format
                    const detectedFormat = detectLogFormat(content);

                    // Store the handle globally
                    setFileHandle(handle);
                    setLazyReader(null);

                    // Store file info in Redux
                    dispatch(setLogFile({
                        name: file.name,
                        size: file.size,
                        content: content,
                        format: detectedFormat || 'Unknown',
                        lastModified: file.lastModified,
                        hasFileHandle: true,
                        totalLines: content.split(/\r?\n/).length,
                        useLazyLoading: false,
                    }));
                }
                
                dispatch(setMonitoringState(true));

                setTimeout(() => {
                    navigate(RouteViewLogs);
                }, 300);

            } catch (error) {
                if ((error as Error).name !== 'AbortError') {
                    console.error('Error selecting file:', error);
                }
                setIndexing(false);
            }
        } else {
            // Fallback to regular file input
            fileInputRef.current?.click();
        }
    };

    const handleStopMonitoring = () => {
        dispatch(setMonitoringState(false));
        setFileHandle(null); // Clear the global file handle
    };

    const handleViewLogs = () => {
        navigate(RouteViewLogs);
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                height: '100%',
                width: '100%',
            }}
        >
            {!isMonitoring ? (
                <>
                    <Typography
                        variant="h4"
                        gutterBottom
                    >
                        Welcome to LogViewer!
                    </Typography>
                    <Typography
                        variant="body1"
                        sx={{
                            maxWidth: 500,
                            textAlign: 'center',
                        }}
                    >
                        Select a log file to monitor in real-time. You can edit the file in any text editor, and changes will be reflected here automatically.
                    </Typography>
                    {indexing ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <CircularProgress />
                            <Typography variant="body2" color="text.secondary">
                                Indexing large file...
                            </Typography>
                        </Box>
                    ) : (
                        <Button
                            variant="contained"
                            startIcon={<CloudUploadIcon />}
                            size="large"
                            onClick={handleSelectWithFSA}
                        >
                            Select log file
                        </Button>
                    )}
                    <input
                        type="file"
                        accept=".txt,.json,.log"
                        style={{ display: 'none' }}
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                    />
                </>
            ) : (
                <>
                    <CheckCircleIcon sx={{ fontSize: 80, color: 'success.main' }} />
                    <Typography
                        variant="h4"
                        gutterBottom
                    >
                        Monitoring Active
                    </Typography>
                    <Typography
                        variant="body1"
                        sx={{
                            maxWidth: 500,
                            textAlign: 'center',
                        }}
                    >
                        File: <strong>{fileName}</strong>
                        <br />
                        The file is being monitored for changes. Edit it in your text editor to see live updates.
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button
                            variant="contained"
                            onClick={handleViewLogs}
                            size="large"
                        >
                            View Logs
                        </Button>
                        <Button
                            variant="outlined"
                            onClick={handleStopMonitoring}
                            size="large"
                            color="error"
                        >
                            Stop Monitoring
                        </Button>
                    </Box>
                </>
            )}
        </Box>
    );
}

export default AddLogsPage;