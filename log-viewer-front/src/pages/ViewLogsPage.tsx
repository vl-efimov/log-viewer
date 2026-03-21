import Box from '@mui/material/Box';
import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import type { VirtuosoHandle } from 'react-virtuoso';
import { RootState } from '../redux/store';
import { updateLogContent, appendLogContent, setMonitoringState } from '../redux/slices/logFileSlice';
import { getFileHandle } from '../redux/slices/logFileSlice';
import { parseLogFileForTable } from '../utils/logFormatExamples';
import { getFormatFields, detectLogFormat, type LogFormatField } from '../utils/logFormatDetector';
import { LogFiltersBar } from '../components/LogFiltersBar';
import { LogHistogram } from '../components/LogHistogram';
import type { LogFilters } from '../types/filters';
import { applyLogFilters, getFilteredCount } from '../utils/logFilters';
import { RouteViewLogs } from '../routes/routePaths';
import { FileSelectionView } from '../components/FileSelectionView';
import { useFileLoader } from '../hooks/useFileLoader';
import LogLinesList from '../components/LogLinesList';
import LogToolbar from '../components/LogToolbar';

const ViewLogsPage: React.FC = () => {
    const [selectedLine, setSelectedLine] = useState<number | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [viewMode, setViewMode] = useState<'live-tail' | 'normal'>('live-tail');

    const dispatch = useDispatch();
    const navigate = useNavigate();
    
    // Get data from Redux
    const { content, name: fileName, isMonitoring, hasFileHandle, size: fileSize } = useSelector((state: RootState) => state.logFile);
    
    const [parsedLines, setParsedLines] = useState<Array<{
        lineNumber: number;
        parsed: import('../utils/logFormatDetector').ParsedLogLine | null;
        raw: string;
        error?: string;
            }>>([]);
    const [filters, setFilters] = useState<LogFilters>({});
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [newLinesCount, setNewLinesCount] = useState<number>(0);
    const lastModifiedRef = useRef<number>(0);
    const lastSizeRef = useRef<number>(0);
    const previousLineCountRef = useRef<number>(0);
    const {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
    } = useFileLoader();

    const scrollToBottom = () => {
        if (virtuosoRef.current) {
            if (displayLines.length > 0) {
                virtuosoRef.current.scrollToIndex({
                    index: viewMode === 'live-tail' ? 0 : displayLines.length - 1,
                    align: viewMode === 'live-tail' ? 'start' : 'end',
                    behavior: 'auto'
                });
            }
        }
    };

    // Load initial content from Redux
    useEffect(() => {
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
    }, [content, fileSize]);

    // Apply filters to parsed lines
    const filteredLines = useMemo(() => {
        return applyLogFilters(parsedLines, filters);
    }, [parsedLines, filters]);

    const displayLines = useMemo(() => {
        const total = filteredLines.length;
        if (viewMode === 'live-tail') {
            return filteredLines.slice().reverse().map((line, idx) => ({
                raw: line.raw,
                displayLineNumber: total - idx,
            }));
        }

        return filteredLines.map((line) => ({
            raw: line.raw,
            displayLineNumber: line.lineNumber,
        }));
    }, [filteredLines, viewMode]);

    // Get filter statistics
    const filterStats = useMemo(() => {
        return getFilteredCount(parsedLines, filters);
    }, [parsedLines, filters]);

    // Get field definitions from detected format for filter configuration
    const fieldDefinitions = useMemo((): LogFormatField[] => {
        console.log('fieldDefinitions: Computing field definitions');
        console.log('  - parsedLines.length:', parsedLines.length);
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
    }, [parsedLines, content]);

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
        navigate(RouteViewLogs);
    };

    if (!isMonitoring) {
        return(         
            <FileSelectionView
                indexing={indexing}
                onFileSelect={handleFileSystemAccess}
                onFileInputChange={handleFileInputChange}
            />
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
            <LogToolbar
                fileName={fileName}
                lastUpdate={lastUpdate}
                onReloadFile={handleReloadFile}
                onManualRefresh={handleManualRefresh}
                onScrollToBottom={scrollToBottom}
                autoRefresh={autoRefresh}
                onToggleAutoRefresh={handleToggleAutoRefresh}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                parsedLinesCount={parsedLines.length}
                filterStats={filterStats}
                contentSize={content?.length || 0}
                fileSize={fileSize}
                newLinesCount={newLinesCount}
            />

            {/* Log Timeline Histogram */}
            {parsedLines.length > 0 && (
                <LogHistogram
                    parsedLines={parsedLines}
                    defaultCollapsed={false}
                    height={150}
                />
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
                <LogLinesList
                    displayLines={displayLines}
                    selectedLine={selectedLine}
                    onSelectLine={setSelectedLine}
                    virtuosoRef={virtuosoRef}
                />
            </Box>
        </Box>
    );
}
export default ViewLogsPage;