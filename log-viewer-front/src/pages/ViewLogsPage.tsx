import Box from '@mui/material/Box';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { VirtuosoHandle } from 'react-virtuoso';
import { RootState } from '../redux/store';
import { updateLogContent, appendLogContent, setMonitoringState } from '../redux/slices/logFileSlice';
import { getFileHandle, getFileObject } from '../redux/slices/logFileSlice';
import { parseLogFileForTable } from '../utils/logFormatExamples';
import { getFormatFields, detectLogFormat, type LogFormatField } from '../utils/logFormatDetector';
import { LogFiltersBar } from '../components/LogFiltersBar';
import { LogHistogram } from '../components/LogHistogram';
import type { LogFilters } from '../types/filters';
import { applyLogFilters, getFilteredCount } from '../utils/logFilters';
import { FileSelectionView } from '../components/FileSelectionView';
import { useFileLoader } from '../hooks/useFileLoader';
import LogLinesList from '../components/LogLinesList';
import LogToolbar from '../components/LogToolbar';

const LINE_INDEX_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB
const LINE_INDEX_CHUNK_SIZE = 1_000_000; // Offsets per chunk
const RANGE_LOAD_PADDING = 60;
const MAX_CACHE_LINES = 500;
const MAX_CACHE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_RANGE_BYTES = 512 * 1024; // 512 KB

type LineIndex = {
    chunks: Uint32Array[];
    length: number;
    chunkSize: number;
};

const createLineIndex = (): LineIndex => ({
    chunks: [],
    length: 0,
    chunkSize: LINE_INDEX_CHUNK_SIZE,
});

const getOffsetAt = (index: LineIndex, idx: number): number => {
    const chunkIndex = Math.floor(idx / index.chunkSize);
    const offsetIndex = idx % index.chunkSize;
    return index.chunks[chunkIndex][offsetIndex];
};

const pushOffset = (index: LineIndex, value: number) => {
    const chunkIndex = Math.floor(index.length / index.chunkSize);
    const offsetIndex = index.length % index.chunkSize;
    if (!index.chunks[chunkIndex]) {
        index.chunks[chunkIndex] = new Uint32Array(index.chunkSize);
    }
    index.chunks[chunkIndex][offsetIndex] = value;
    index.length += 1;
};

const popOffset = (index: LineIndex): number | null => {
    if (index.length === 0) return null;
    const idx = index.length - 1;
    const value = getOffsetAt(index, idx);
    index.length -= 1;
    return value;
};

const ViewLogsPage: React.FC = () => {
    const [selectedLine, setSelectedLine] = useState<number | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [viewMode, setViewMode] = useState<'live-tail' | 'normal'>('live-tail');

    const dispatch = useDispatch();
    
    // Get data from Redux
    const { content, name: fileName, isMonitoring, hasFileHandle, size: fileSize, isLargeFile } = useSelector((state: RootState) => state.logFile);
    
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
    const lineOffsetsRef = useRef<LineIndex>(createLineIndex());
    const lineCacheRef = useRef<Map<number, { text: string; size: number }>>(new Map());
    const cacheBytesRef = useRef<number>(0);
    const [lineCount, setLineCount] = useState<number>(0);
    const [lineCacheVersion, setLineCacheVersion] = useState<number>(0);
    const rangeLoadStateRef = useRef<{ pending: { start: number; end: number } | null; isLoading: boolean }>({
        pending: null,
        isLoading: false,
    });
    const {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
    } = useFileLoader();

    const getActiveFile = useCallback(async (): Promise<File | null> => {
        const handle = getFileHandle();
        if (handle) {
            return await handle.getFile();
        }

        return getFileObject();
    }, []);

    const buildLineIndex = useCallback(async (file: File): Promise<LineIndex> => {
        const offsets = createLineIndex();
        if (file.size === 0) {
            return offsets;
        }

        pushOffset(offsets, 0);

        let offset = 0;
        while (offset < file.size) {
            const buffer = await file.slice(offset, offset + LINE_INDEX_CHUNK_BYTES).arrayBuffer();
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.length; i += 1) {
                if (bytes[i] === 10) {
                    pushOffset(offsets, offset + i + 1);
                }
            }
            offset += bytes.length;
        }

        if (offsets.length > 0) {
            const lastOffset = getOffsetAt(offsets, offsets.length - 1);
            if (lastOffset === file.size) {
                popOffset(offsets);
            }
        }

        return offsets;
    }, []);

    const loadLinesForRange = useCallback(async (startIndex: number, endIndex: number) => {
        const offsets = lineOffsetsRef.current;
        if (offsets.length === 0) return;

        const start = Math.max(0, startIndex);
        const end = Math.min(endIndex, offsets.length - 1);

        const cache = lineCacheRef.current;
        let hasMissing = false;
        for (let i = start; i <= end; i += 1) {
            if (!cache.has(i)) {
                hasMissing = true;
                break;
            }
        }
        if (!hasMissing) return;

        const file = await getActiveFile();
        if (!file) return;

        const startOffset = getOffsetAt(offsets, start);
        let effectiveEnd = end;

        // Clamp by byte range to avoid huge allocations when lines are very long.
        if (end >= start) {
            let low = start;
            let high = end;
            let best = start;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const midEndOffset = mid + 1 < offsets.length ? getOffsetAt(offsets, mid + 1) : file.size;
                if (midEndOffset - startOffset <= MAX_RANGE_BYTES) {
                    best = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            effectiveEnd = Math.max(start, best);
        }

        const endOffset = effectiveEnd + 1 < offsets.length ? getOffsetAt(offsets, effectiveEnd + 1) : file.size;
        const buffer = await file.slice(startOffset, endOffset).arrayBuffer();
        const text = new TextDecoder('utf-8').decode(buffer);
        const lines = text.split(/\r?\n/);

        const expectedCount = effectiveEnd - start + 1;
        if (lines.length > expectedCount) {
            lines.length = expectedCount;
        }

        const touchCacheEntry = (index: number, value: string) => {
            const size = value.length * 2;
            const existing = cache.get(index);
            if (existing) {
                cache.delete(index);
                cacheBytesRef.current -= existing.size;
            }
            cache.set(index, { text: value, size });
            cacheBytesRef.current += size;
        };

        for (let i = 0; i < lines.length; i += 1) {
            touchCacheEntry(start + i, lines[i]);
        }

        while (cache.size > MAX_CACHE_LINES || cacheBytesRef.current > MAX_CACHE_BYTES) {
            const oldestKey = cache.keys().next().value as number | undefined;
            if (oldestKey === undefined) break;
            const removed = cache.get(oldestKey);
            cache.delete(oldestKey);
            if (removed) {
                cacheBytesRef.current -= removed.size;
            }
        }

        if (effectiveEnd < end) {
            const state = rangeLoadStateRef.current;
            const nextRange = { start: effectiveEnd + 1, end };
            state.pending = state.pending
                ? {
                    start: Math.min(state.pending.start, nextRange.start),
                    end: Math.max(state.pending.end, nextRange.end),
                }
                : nextRange;
        }

        setLineCacheVersion((version) => version + 1);
    }, [getActiveFile]);

    const requestRangeLoad = useCallback((startIndex: number, endIndex: number) => {
        const state = rangeLoadStateRef.current;
        const nextStart = Math.max(0, startIndex - RANGE_LOAD_PADDING);
        const nextEnd = Math.min(endIndex + RANGE_LOAD_PADDING, lineCount - 1);

        if (nextEnd < 0) return;

        if (state.pending) {
            state.pending = {
                start: Math.min(state.pending.start, nextStart),
                end: Math.max(state.pending.end, nextEnd),
            };
        } else {
            state.pending = { start: nextStart, end: nextEnd };
        }

        if (state.isLoading) return;

        const run = async () => {
            state.isLoading = true;
            while (state.pending) {
                const { start, end } = state.pending;
                state.pending = null;
                await loadLinesForRange(start, end);
            }
            state.isLoading = false;
        };

        void run();
    }, [lineCount, loadLinesForRange]);

    const scrollToBottom = () => {
        if (virtuosoRef.current) {
            const totalDisplayCount = isLargeFile ? lineCount : displayLines.length;
            if (totalDisplayCount > 0) {
                virtuosoRef.current.scrollToIndex({
                    index: viewMode === 'live-tail' ? 0 : totalDisplayCount - 1,
                    align: viewMode === 'live-tail' ? 'start' : 'end',
                    behavior: 'auto'
                });
            }
        }
    };

    // Load initial content from Redux
    useEffect(() => {
        if (isLargeFile) {
            setParsedLines([]);
            previousLineCountRef.current = 0;
            lastSizeRef.current = fileSize;
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
    }, [content, fileSize, isLargeFile]);

    // Apply filters to parsed lines
    const filteredLines = useMemo(() => {
        if (isLargeFile) {
            return [];
        }
        return applyLogFilters(parsedLines, filters);
    }, [parsedLines, filters, isLargeFile]);

    const displayLines = useMemo(() => {
        if (isLargeFile) {
            return [];
        }

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
    }, [filteredLines, viewMode, isLargeFile]);

    const getLineAtIndex = useCallback((displayIndex: number) => {
        if (!isLargeFile) {
            return displayLines[displayIndex] ?? null;
        }

        if (lineCount === 0) return null;

        const fileIndex = viewMode === 'live-tail'
            ? lineCount - 1 - displayIndex
            : displayIndex;

        if (fileIndex < 0 || fileIndex >= lineCount) return null;

        const rawEntry = lineCacheRef.current.get(fileIndex);

        const displayLineNumber = viewMode === 'live-tail'
            ? lineCount - displayIndex
            : fileIndex + 1;

        return { raw: rawEntry?.text ?? 'Loading...', displayLineNumber };
    }, [displayLines, isLargeFile, lineCount, viewMode, lineCacheVersion]);

    const handleRangeChange = useCallback((startIndex: number, endIndex: number) => {
        if (!isLargeFile || lineCount === 0) return;

        const safeStart = Math.max(0, Math.min(startIndex, lineCount - 1));
        const safeEnd = Math.max(0, Math.min(endIndex, lineCount - 1));

        const mappedStart = viewMode === 'live-tail'
            ? lineCount - 1 - safeEnd
            : safeStart;
        const mappedEnd = viewMode === 'live-tail'
            ? lineCount - 1 - safeStart
            : safeEnd;

        requestRangeLoad(mappedStart, mappedEnd);
    }, [isLargeFile, lineCount, requestRangeLoad, viewMode]);

    // Get filter statistics
    const filterStats = useMemo(() => {
        if (isLargeFile) {
            return { total: lineCount, filtered: lineCount, parsedFiltered: 0 };
        }
        return getFilteredCount(parsedLines, filters);
    }, [parsedLines, filters, isLargeFile, lineCount]);

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

    useEffect(() => {
        if (!isMonitoring || !isLargeFile) return;

        let cancelled = false;

        const buildIndex = async () => {
            const file = await getActiveFile();
            if (!file) return;

            lastModifiedRef.current = file.lastModified;
            lastSizeRef.current = file.size;
            lineCacheRef.current = new Map();
            cacheBytesRef.current = 0;
            setLineCacheVersion((version) => version + 1);

            const offsets = await buildLineIndex(file);
            if (cancelled) return;

            lineOffsetsRef.current = offsets;
            setLineCount(offsets.length);

            if (offsets.length > 0) {
                if (viewMode === 'live-tail') {
                    const start = Math.max(0, offsets.length - 1 - RANGE_LOAD_PADDING);
                    requestRangeLoad(start, offsets.length - 1);
                } else {
                    requestRangeLoad(0, Math.min(RANGE_LOAD_PADDING, offsets.length - 1));
                }
            }
        };

        void buildIndex();

        return () => {
            cancelled = true;
        };
    }, [isMonitoring, isLargeFile, fileName, buildLineIndex, getActiveFile, requestRangeLoad]);

    useEffect(() => {
        if (!isLargeFile || lineCount === 0) return;

        if (viewMode === 'live-tail') {
            const start = Math.max(0, lineCount - 1 - RANGE_LOAD_PADDING);
            requestRangeLoad(start, lineCount - 1);
        } else {
            requestRangeLoad(0, Math.min(RANGE_LOAD_PADDING, lineCount - 1));
        }
    }, [viewMode, isLargeFile, lineCount, requestRangeLoad]);

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

                            if (isLargeFile) {
                                if (currentSize < lastSizeRef.current) {
                                    console.log('File truncated, rebuilding index');
                                    const offsets = await buildLineIndex(file);
                                    lineOffsetsRef.current = offsets;
                                    lineCacheRef.current = new Map();
                                    cacheBytesRef.current = 0;
                                    setLineCacheVersion((version) => version + 1);
                                    setLineCount(offsets.length);
                                    lastSizeRef.current = currentSize;
                                    setLastUpdate(new Date());
                                } else if (currentSize > lastSizeRef.current) {
                                    console.log(`File grew from ${lastSizeRef.current} to ${currentSize} bytes, indexing increment`);

                                    const buffer = await file.slice(lastSizeRef.current, currentSize).arrayBuffer();
                                    const bytes = new Uint8Array(buffer);
                                    const offsets = lineOffsetsRef.current;
                                    const previousCount = offsets.length;
                                    for (let i = 0; i < bytes.length; i += 1) {
                                        if (bytes[i] === 10) {
                                            pushOffset(offsets, lastSizeRef.current + i + 1);
                                        }
                                    }

                                    const addedLines = offsets.length - previousCount;
                                    if (addedLines > 0) {
                                        setNewLinesCount(addedLines);
                                        setTimeout(() => setNewLinesCount(0), 3000);
                                    }

                                    setLineCount(offsets.length);
                                    lastSizeRef.current = currentSize;
                                    setLastUpdate(new Date());

                                    if (viewMode === 'live-tail' && offsets.length > 0) {
                                        const start = Math.max(0, offsets.length - 1 - RANGE_LOAD_PADDING);
                                        requestRangeLoad(start, offsets.length - 1);
                                    }
                                } else {
                                    console.log('File modified but size unchanged, skipping update');
                                }

                                return;
                            }

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
    }, [isMonitoring, autoRefresh, hasFileHandle, dispatch, isLargeFile, buildLineIndex, lineCount, requestRangeLoad, viewMode]);

    const handleToggleAutoRefresh = () => {
        setAutoRefresh(prev => !prev);
    };

    const handleManualRefresh = async () => {
        const fileHandle = getFileHandle();
        if (!fileHandle && !isLargeFile) return;

        try {
            if (isLargeFile) {
                const file = await getActiveFile();
                if (!file) return;

                lastModifiedRef.current = file.lastModified;
                lastSizeRef.current = file.size;
                const offsets = await buildLineIndex(file);
                lineOffsetsRef.current = offsets;
                lineCacheRef.current = new Map();
                cacheBytesRef.current = 0;
                setLineCacheVersion((version) => version + 1);
                setLineCount(offsets.length);
                setLastUpdate(new Date());
                if (offsets.length > 0) {
                    if (viewMode === 'live-tail') {
                        const start = Math.max(0, offsets.length - 1 - RANGE_LOAD_PADDING);
                        requestRangeLoad(start, offsets.length - 1);
                    } else {
                        requestRangeLoad(0, Math.min(RANGE_LOAD_PADDING, offsets.length - 1));
                    }
                }
                return;
            }

            if (!fileHandle) return;

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
                parsedLinesCount={isLargeFile ? lineCount : parsedLines.length}
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
                    totalCount={isLargeFile ? lineCount : displayLines.length}
                    getLineAtIndex={getLineAtIndex}
                    onRangeChange={isLargeFile ? handleRangeChange : undefined}
                    selectedLine={selectedLine}
                    onSelectLine={setSelectedLine}
                    virtuosoRef={virtuosoRef}
                />
            </Box>
        </Box>
    );
}
export default ViewLogsPage;