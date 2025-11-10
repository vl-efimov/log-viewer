import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { RootState } from '../redux/store';
import { updateLogContent, appendLogContent, setMonitoringState } from '../redux/slices/logFileSlice';
import { getFileHandle, getLazyReader } from '../redux/slices/logFileSlice';
import { parseLogFileForTable } from '../utils/logFormatExamples';
import { getFormatFields, detectLogFormat, type LogFormatField } from '../utils/logFormatDetector';
import { LRUCache } from '../utils/lruCache';
import NoFileSelected from '../components/NoFileSelected';
import { RouteHome } from '../routes/routePaths';
import { LogFiltersBar } from '../components/LogFiltersBar';
import type { LogFilters } from '../types/filters';
import { applyLogFilters, getFilteredCount } from '../utils/logFilters';

// Dynamic cache size based on file size
const getCacheSize = (fileSize: number): number => {
    if (fileSize < 100 * 1024 * 1024) return 2000; // < 100MB: 2000 lines
    if (fileSize < 500 * 1024 * 1024) return 1000; // < 500MB: 1000 lines
    return 500; // >= 500MB: 500 lines (more aggressive)
};

const LAZY_CACHE_SIZE = 2000; // Default cache size

// Virtual pagination for very large files
const VIRTUAL_PAGE_SIZE = 100000; // Show 100k lines at a time
const VIRTUAL_BUFFER = 10000; // Buffer 10k lines before/after


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
    const [filters, setFilters] = useState<LogFilters>({});
    const [lazyCache] = useState<LRUCache<number, string>>(() => new LRUCache(LAZY_CACHE_SIZE));
    const [previewContent, setPreviewContent] = useState<string>(''); // Preview for format detection in lazy mode
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [newLinesCount, setNewLinesCount] = useState<number>(0);
    const [cacheStats, setCacheStats] = useState({ size: 0, capacity: LAZY_CACHE_SIZE });
    const [virtualWindow, setVirtualWindow] = useState({ start: 1, end: VIRTUAL_PAGE_SIZE });
    const lastModifiedRef = useRef<number>(0);
    const lastSizeRef = useRef<number>(0);
    const previousLineCountRef = useRef<number>(0);

    const scrollToBottom = () => {
        if (virtuosoRef.current) {
            if (useLazyLoading) {
                const count = totalLines;
                
                if (count > VIRTUAL_PAGE_SIZE) {
                    // For large files, adjust window to show last page
                    const newStart = Math.max(1, count - VIRTUAL_PAGE_SIZE + 1);
                    const newEnd = count;
                    setVirtualWindow({ start: newStart, end: newEnd });
                    
                    // Scroll to the last visible item in the window
                    setTimeout(() => {
                        virtuosoRef.current?.scrollToIndex({
                            index: VIRTUAL_PAGE_SIZE - 1,
                            align: 'end',
                            behavior: 'auto'
                        });
                    }, 100);
                } else {
                    virtuosoRef.current.scrollToIndex({
                        index: count - 1,
                        align: 'end',
                        behavior: 'auto'
                    });
                }
            } else {
                // For regular mode, scroll to last filtered line
                const count = filteredLines.length;
                if (count > 0) {
                    virtuosoRef.current.scrollToIndex({
                        index: count - 1,
                        align: 'end',
                        behavior: 'auto'
                    });
                }
            }
        }
    };

    // Function to get line content (lazy or from parsed)
    const getLineContent = useCallback(async (lineNumber: number): Promise<string> => {
        if (useLazyLoading) {
            // Adjust for virtual window offset
            const actualLineNumber = virtualWindow.start + lineNumber - 1;
            
            // Check cache first
            const cached = lazyCache.get(actualLineNumber);
            if (cached !== undefined) {
                return cached;
            }

            // Read from lazy reader
            const reader = getLazyReader();
            if (reader) {
                const content = await reader.readLine(actualLineNumber);
                if (content !== null) {
                    // Add to LRU cache (automatically evicts old entries)
                    lazyCache.set(actualLineNumber, content);
                    
                    // Update cache stats for UI
                    setCacheStats({ size: lazyCache.size(), capacity: lazyCache.getCapacity() });
                    
                    return content;
                }
            }
            return `Loading line ${actualLineNumber}...`;
        } else {
            // Get from parsed lines
            const line = parsedLines.find(l => l.lineNumber === lineNumber);
            return line?.raw || '';
        }
    }, [useLazyLoading, lazyCache, parsedLines, virtualWindow]);

    // Handle scroll range changes to detect when near edges
    const handleRangeChanged = useCallback((range: { startIndex: number, endIndex: number }) => {
        if (!useLazyLoading || totalLines <= VIRTUAL_PAGE_SIZE) {
            return; // No windowing needed
        }

        const { startIndex, endIndex } = range;
        const windowSize = virtualWindow.end - virtualWindow.start + 1;
        
        // Check if near top edge (within buffer)
        if (startIndex < VIRTUAL_BUFFER && virtualWindow.start > 1) {
            const newStart = Math.max(1, virtualWindow.start - VIRTUAL_PAGE_SIZE / 2);
            const newEnd = Math.min(totalLines, newStart + VIRTUAL_PAGE_SIZE - 1);
            setVirtualWindow({ start: newStart, end: newEnd });
            
            // Scroll to middle to give room for both directions
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: VIRTUAL_PAGE_SIZE / 2,
                    align: 'center'
                });
            }, 100);
        }
        // Check if near bottom edge (within buffer)
        else if (endIndex > windowSize - VIRTUAL_BUFFER && virtualWindow.end < totalLines) {
            const newEnd = Math.min(totalLines, virtualWindow.end + VIRTUAL_PAGE_SIZE / 2);
            const newStart = Math.max(1, newEnd - VIRTUAL_PAGE_SIZE + 1);
            setVirtualWindow({ start: newStart, end: newEnd });
            
            // Scroll to middle to give room for both directions
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: VIRTUAL_PAGE_SIZE / 2,
                    align: 'center'
                });
            }, 100);
        }
    }, [useLazyLoading, totalLines, virtualWindow, VIRTUAL_PAGE_SIZE, VIRTUAL_BUFFER]);

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
            
            // Load first 50 lines for format detection
            const loadPreview = async () => {
                console.log('loadPreview: Starting to load preview lines for format detection');
                const reader = getLazyReader();
                console.log('loadPreview: LazyReader available:', !!reader);
                
                if (reader) {
                    const previewLines: string[] = [];
                    for (let i = 1; i <= Math.min(50, totalLines); i++) {
                        const line = await reader.readLine(i);
                        if (line) previewLines.push(line);
                    }
                    const preview = previewLines.join('\n');
                    console.log('loadPreview: Loaded preview lines:', previewLines.length, 'chars:', preview.length);
                    setPreviewContent(preview);
                } else {
                    console.warn('loadPreview: LazyReader not available yet');
                }
            };
            loadPreview();
            
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
    }, [content, fileSize, useLazyLoading, totalLines, lazyCache]);

    // Apply filters to parsed lines
    const filteredLines = useMemo(() => {
        return applyLogFilters(parsedLines, filters);
    }, [parsedLines, filters]);

    // Get filter statistics
    const filterStats = useMemo(() => {
        return getFilteredCount(parsedLines, filters);
    }, [parsedLines, filters]);

    // Get field definitions from detected format for filter configuration
    const fieldDefinitions = useMemo((): LogFormatField[] => {
        console.log('fieldDefinitions: Computing field definitions');
        console.log('  - parsedLines.length:', parsedLines.length);
        console.log('  - useLazyLoading:', useLazyLoading);
        console.log('  - previewContent.length:', previewContent.length);
        console.log('  - content:', content ? `${content.length} chars` : 'empty');
        
        // Try to get formatId from parsed lines first
        if (parsedLines.length > 0) {
            const firstParsed = parsedLines.find(line => line.parsed);
            if (firstParsed?.parsed) {
                console.log('  → Using formatId from parsedLines:', firstParsed.parsed.formatId);
                const fields = getFormatFields(firstParsed.parsed.formatId);
                console.log('  → Field definitions:', fields.length);
                return fields;
            }
        }
        
        // For lazy loading, use preview content
        if (useLazyLoading && previewContent) {
            const formatId = detectLogFormat(previewContent);
            console.log('  → Detected formatId from preview:', formatId, '(should be ID not name)');
            if (formatId) {
                const fields = getFormatFields(formatId);
                console.log('  → Field definitions count:', fields.length);
                if (fields.length > 0) {
                    console.log('  → Field names:', fields.map(f => f.name).join(', '));
                }
                return fields;
            }
        }
        
        // For normal mode without parsed lines, detect from content
        if (content) {
            const formatId = detectLogFormat(content);
            console.log('  → Detected formatId from content:', formatId);
            if (formatId) {
                const fields = getFormatFields(formatId);
                console.log('  → Field definitions:', fields.length);
                return fields;
            }
        }
        
        console.log('  → No field definitions found, returning empty array');
        return [];
    }, [parsedLines, content, useLazyLoading, previewContent]);

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

    if (!isMonitoring) {
        return <NoFileSelected />;
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
                    Total lines: {useLazyLoading ? totalLines : parsedLines.length}
                    {!useLazyLoading && filterStats.filtered !== filterStats.total && (
                        <> | Showing: {filterStats.filtered} ({filterStats.parsedFiltered} parsed + stacktraces)</>
                    )}
                    {' | '}Content size: {(content?.length || 0).toLocaleString()} bytes | File size: {fileSize.toLocaleString()} bytes
                    {useLazyLoading && <> | 🚀 Lazy Loading | Cache: {cacheStats.size}/{cacheStats.capacity}</>}
                    {useLazyLoading && totalLines > VIRTUAL_PAGE_SIZE && (
                        <> | 📍 Viewing lines {virtualWindow.start.toLocaleString()}-{virtualWindow.end.toLocaleString()}</>
                    )}
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

            {/* Lazy Loading Warning */}
            {useLazyLoading && (
                <Alert severity="info" sx={{ mb: 1 }}>
                    <Typography variant="body2">
                        <strong>Large File Mode:</strong> Filtering is displayed but not yet functional for files in lazy loading mode (&gt;50MB). 
                        This feature requires parsing all {totalLines.toLocaleString()} lines which may cause performance issues.
                        Filters are shown for reference based on detected format.
                    </Typography>
                </Alert>
            )}

            {/* Filters Bar */}
            <LogFiltersBar
                filters={filters}
                onFiltersChange={setFilters}
                fieldDefinitions={fieldDefinitions}
            />

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
                    totalCount={useLazyLoading ? Math.min(VIRTUAL_PAGE_SIZE, totalLines) : filteredLines.length}
                    overscan={200}
                    fixedItemHeight={20}
                    computeItemKey={(index) => {
                        // Use global line number for stable keys
                        if (useLazyLoading) {
                            return virtualWindow.start + index;
                        } else {
                            return filteredLines[index]?.lineNumber || index;
                        }
                    }}
                    rangeChanged={handleRangeChanged}
                    itemContent={(index) => {
                        if (useLazyLoading) {
                            const lineNumber = index + 1;  // Window-relative for fetching
                            const displayLineNumber = virtualWindow.start + index;  // Show actual global line number
                            
                            // Lazy loading mode - render placeholder and fetch on mount
                            return (
                                <LazyLogLine
                                    lineNumber={lineNumber}
                                    displayLineNumber={displayLineNumber}
                                    selected={selectedLine === displayLineNumber}
                                    onSelect={() => setSelectedLine(displayLineNumber)}
                                    getContent={getLineContent}
                                />
                            );
                        } else {
                            // Regular mode - render from filtered lines
                            const row = filteredLines[index];
                            if (!row) {
                                console.warn(`Missing row at index ${index}, total: ${filteredLines.length}`);
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
    displayLineNumber: number;
    selected: boolean;
    onSelect: () => void;
    getContent: (lineNumber: number) => Promise<string>;
}> = ({ lineNumber, displayLineNumber, selected, onSelect, getContent }) => {
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
                {displayLineNumber}
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