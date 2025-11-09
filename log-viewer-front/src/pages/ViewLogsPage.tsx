import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import React from 'react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { RouteHome } from '../routes/routePaths';
import { RootState } from '../redux/store';
import { updateLogContent, appendLogContent, setMonitoringState } from '../redux/slices/logFileSlice';
import { getFileHandle, getLazyReader } from '../redux/slices/logFileSlice';
import { parseLogFileForTable } from '../utils/logFormatExamples';
import { LRUCache } from '../utils/lruCache';

// Dynamic cache size based on file size
const getCacheSize = (fileSize: number): number => {
    if (fileSize < 100 * 1024 * 1024) return 2000; // < 100MB: 2000 lines
    if (fileSize < 500 * 1024 * 1024) return 1000; // < 500MB: 1000 lines
    return 500; // >= 500MB: 500 lines (more aggressive)
};

const LAZY_CACHE_SIZE = 2000; // Default cache size


const ViewLogsPage: React.FC = () => {
    const [selectedLine, setSelectedLine] = useState<number | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const dispatch = useDispatch();
    const navigate = useNavigate();
    
    // Get data from Redux
    const { content, name: fileName, isMonitoring, hasFileHandle, size: fileSize, totalLines, useLazyLoading } = useSelector((state: RootState) => state.logFile);
    
    const [parsedLines, setParsedLines] = useState<Array<{
        lineNumber: number;
        parsed: import('../utils/logFormatDetector').ParsedLogLine | null;
        raw: string;
        error?: string;
            }>>([]);
    const [lazyCache] = useState<LRUCache<number, string>>(() => new LRUCache(LAZY_CACHE_SIZE));
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [newLinesCount, setNewLinesCount] = useState<number>(0);
    const [cacheStats, setCacheStats] = useState({ size: 0, capacity: LAZY_CACHE_SIZE });
    const lastModifiedRef = useRef<number>(0);
    const lastSizeRef = useRef<number>(0);
    const previousLineCountRef = useRef<number>(0);

    const scrollToBottom = () => {
        if (virtuosoRef.current) {
            const count = useLazyLoading ? totalLines : parsedLines.length;
            virtuosoRef.current.scrollToIndex({
                index: count - 1,
                align: 'end',
                behavior: 'auto'
            });
        }
    };

    // Function to get line content (lazy or from parsed)
    const getLineContent = useCallback(async (lineNumber: number): Promise<string> => {
        if (useLazyLoading) {
            // Check cache first
            const cached = lazyCache.get(lineNumber);
            if (cached !== undefined) {
                return cached;
            }

            // Read from lazy reader
            const reader = getLazyReader();
            if (reader) {
                const content = await reader.readLine(lineNumber);
                if (content !== null) {
                    // Add to LRU cache (automatically evicts old entries)
                    lazyCache.set(lineNumber, content);
                    
                    // Update cache stats for UI
                    setCacheStats({ size: lazyCache.size(), capacity: lazyCache.getCapacity() });
                    
                    return content;
                }
            }
            return `Loading line ${lineNumber}...`;
        } else {
            // Get from parsed lines
            const line = parsedLines.find(l => l.lineNumber === lineNumber);
            return line?.raw || '';
        }
    }, [useLazyLoading, lazyCache, parsedLines]);

    // Load initial content from Redux
    useEffect(() => {
        if (useLazyLoading) {
            // For lazy loading, we don't parse all lines upfront
            console.log('Using lazy loading, totalLines:', totalLines);
            
            // Adjust cache size based on file size
            const optimalCacheSize = getCacheSize(fileSize);
            if (lazyCache.getCapacity() !== optimalCacheSize) {
                lazyCache.setCapacity(optimalCacheSize);
                console.log(`Cache size adjusted to ${optimalCacheSize} for file size ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
            }
            
            // Clear cache when file changes
            lazyCache.clear();
            setCacheStats({ size: 0, capacity: lazyCache.getCapacity() });
            
            return;
        }

        const safeContent = content ?? "";
        console.log('Content length in bytes:', safeContent.length);
        console.log('Content lines count:', safeContent.split(/\r?\n/).length);
        
        const parsed = parseLogFileForTable(safeContent);
        console.log('Parsed lines count:', parsed.length);
        if (parsed.length > 0) {
            console.log('First line number:', parsed[0].lineNumber);
            console.log('Last line number:', parsed[parsed.length - 1].lineNumber);
        }
        
        setParsedLines(parsed);
        setLastUpdate(new Date());
        // Track new lines added
        if (previousLineCountRef.current > 0 && parsed.length - previousLineCountRef.current > 0) {
            setNewLinesCount(parsed.length - previousLineCountRef.current);
            setTimeout(() => setNewLinesCount(0), 3000);
        }
        previousLineCountRef.current = parsed.length;
        lastSizeRef.current = fileSize;
    }, [content, fileSize, useLazyLoading, totalLines]);

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
                width: '100%',
                overflow: 'hidden',
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
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
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={scrollToBottom}
                >
                    Jump to End
                </Typography>
                <Chip 
                    label={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                    color={autoRefresh ? 'success' : 'default'}
                    onClick={handleToggleAutoRefresh}
                    size="small"
                    sx={{ cursor: 'pointer' }}
                />
                <Typography variant="caption" color="text.secondary">
                    Total lines: {useLazyLoading ? totalLines : parsedLines.length} | Content size: {(content?.length || 0).toLocaleString()} bytes | File size: {fileSize.toLocaleString()} bytes
                    {useLazyLoading && <> | 🚀 Lazy Loading | Cache: {cacheStats.size}/{cacheStats.capacity}</>}
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

            <Box 
                sx={{ 
                    flexGrow: 1, 
                    flexShrink: 1,
                    minHeight: 0,
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#fafafa',
                    borderRadius: 1,
                    overflow: 'hidden',
                }}
            >
                <Virtuoso
                    ref={virtuosoRef}
                    style={{ height: '100%', width: '100%' }}
                    totalCount={useLazyLoading ? totalLines : parsedLines.length}
                    overscan={200}
                    fixedItemHeight={20}
                    computeItemKey={(index) => index + 1}
                    itemContent={(index) => {
                        const lineNumber = index + 1;
                        
                        if (useLazyLoading) {
                            // Lazy loading mode - render placeholder and fetch on mount
                            return (
                                <LazyLogLine
                                    lineNumber={lineNumber}
                                    selected={selectedLine === lineNumber}
                                    onSelect={() => setSelectedLine(lineNumber)}
                                    getContent={getLineContent}
                                />
                            );
                        } else {
                            // Regular mode - render from parsed lines
                            const row = parsedLines[index];
                            if (!row) {
                                console.warn(`Missing row at index ${index}, total: ${parsedLines.length}`);
                                return null;
                            }
                            
                            return (
                                <Box
                                    sx={{
                                        display: 'flex',
                                        height: '20px',
                                        alignItems: 'center',
                                        px: 2,
                                        cursor: 'pointer',
                                        backgroundColor: selectedLine === row.lineNumber ? '#e3f2fd' : 'transparent',
                                        '&:hover': {
                                            backgroundColor: selectedLine === row.lineNumber ? '#e3f2fd' : (theme) => theme.palette.action.hover,
                                        },
                                    }}
                                    onClick={() => setSelectedLine(row.lineNumber)}
                                >
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            minWidth: '80px',
                                            color: 'text.secondary',
                                            fontFamily: 'monospace',
                                            fontSize: '0.8rem',
                                            lineHeight: '20px',
                                            userSelect: 'none',
                                            mr: 2,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {row.lineNumber}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            fontFamily: 'monospace',
                                            fontSize: '0.8rem',
                                            lineHeight: '20px',
                                            flex: 1,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        {row.raw}
                                    </Typography>
                                </Box>
                            );
                        }
                    }}
                />
            </Box>
        </Box>
    );
}

// Component for lazily loaded log lines
const LazyLogLine: React.FC<{
    lineNumber: number;
    selected: boolean;
    onSelect: () => void;
    getContent: (lineNumber: number) => Promise<string>;
}> = ({ lineNumber, selected, onSelect, getContent }) => {
    const [content, setContent] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        
        getContent(lineNumber).then(text => {
            if (mounted) {
                setContent(text);
                setLoading(false);
            }
        });

        return () => {
            mounted = false;
        };
    }, [lineNumber, getContent]);

    return (
        <Box
            sx={{
                display: 'flex',
                height: '20px',
                alignItems: 'center',
                px: 2,
                cursor: 'pointer',
                backgroundColor: selected ? '#e3f2fd' : 'transparent',
                '&:hover': {
                    backgroundColor: selected ? '#e3f2fd' : (theme) => theme.palette.action.hover,
                },
            }}
            onClick={onSelect}
        >
            <Typography
                variant="body2"
                sx={{
                    minWidth: '80px',
                    color: 'text.secondary',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: '20px',
                    userSelect: 'none',
                    mr: 2,
                    flexShrink: 0,
                }}
            >
                {lineNumber}
            </Typography>
            <Typography
                variant="body2"
                sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: '20px',
                    flex: 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: loading ? 0.5 : 1,
                }}
            >
                {content}
            </Typography>
        </Box>
    );
};

export default ViewLogsPage;