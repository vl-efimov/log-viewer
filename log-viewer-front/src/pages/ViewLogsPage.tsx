import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { VirtuosoHandle } from 'react-virtuoso';
import { RootState } from '../redux/store';
import { ViewModeEnum } from '../constants/ViewModeEnum';
import {
    updateLogContent,
    clearLogContent,
    setLogFile,
    setIndexingState,
} from '../redux/slices/logFileSlice';
import {
    clearAnomalyResults,
    setAnomalyResults,
} from '../redux/slices/anomalySlice';
import { getFileHandle, getFileObject } from '../redux/slices/logFileSlice';
import { getFormatFields, detectLogFormat, getLogFormatById, parseLogLineAuto, type LogFormatField, type ParsedLogLine } from '../utils/logFormatDetector';
import { LogHistogram } from '../components/LogHistogram';
import type { LogFilters } from '../types/filters';
import { applyLogFilters } from '../utils/logFilters';
import { FileSelectionView } from '../components/FileSelectionView';
import { useFileLoader } from '../hooks/useFileLoader';
import { useParsedRowsCache } from '../hooks/useParsedRowsCache';
import LogLinesList from '../components/LogLinesList';
import LogToolbar from '../components/LogToolbar';
import {
    deleteAnomalySnapshot,
    getAnomalySnapshot,
    getDashboardSnapshot,
    getLinesRange,
    getSessionLineCount,
    queryFilteredLines,
    saveAnomalySnapshot,
} from '../utils/logIndexedDb';
import { appendLogFileToIndex } from '../utils/logIndexer';
import { finishRemoteIngest, startRemoteIngest, uploadRemoteIngestChunk } from '../services/bglAnomalyApi';

const LINE_INDEX_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB
const LINE_INDEX_CHUNK_SIZE = 1_000_000; // Offsets per chunk
const RANGE_LOAD_PADDING = 60;
const MAX_CACHE_LINES = 500;
const MAX_CACHE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_RANGE_BYTES = 512 * 1024; // 512 KB
const MAX_VIRTUAL_ROWS = 1_500_000;
const WINDOW_REBASE_MARGIN = 200_000;
const MAX_LARGE_FILE_VIEW_CACHE_ENTRIES = 3;
const MAX_INDEXED_FILTER_ROWS = 50_000;
const FILTER_PROGRESS_UI_BATCH_ROWS = 5_000;
const PREVIEW_BYTES = 2 * 1024 * 1024;
const DB_RANGE_LOAD_PADDING = 120;
const REMOTE_INGEST_CHUNK_BYTES = 4 * 1024 * 1024;

type ViewParsedLine = {
    lineNumber: number;
    parsed: ParsedLogLine | null;
    raw: string;
    error?: string;
};

type ViewRow = {
    lineNumber: number;
    raw: string;
};

type LineIndex = {
    chunks: Uint32Array[];
    length: number;
    chunkSize: number;
};

type LargeFileViewCacheEntry = {
    lineOffsets: LineIndex;
    lineCount: number;
};

type DbLineCacheEntry = {
    text: string;
    size: number;
};

const largeFileViewCache = new Map<string, LargeFileViewCacheEntry>();

const setLargeFileViewCache = (key: string, value: LargeFileViewCacheEntry) => {
    largeFileViewCache.delete(key);
    largeFileViewCache.set(key, value);

    while (largeFileViewCache.size > MAX_LARGE_FILE_VIEW_CACHE_ENTRIES) {
        const oldestKey = largeFileViewCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        largeFileViewCache.delete(oldestKey);
    }
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

const buildRowsForView = (logContent: string): ViewRow[] => {
    const lines = logContent.split(/\r?\n/);
    const rows: ViewRow[] = [];

    const isContinuationLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed) {
            return false;
        }

        return (
            /^\s+at\s+/.test(line)
            || /^\s*\.\.\.\s+\d+\s+more$/.test(trimmed)
            || /^\s*Caused by:/.test(trimmed)
            || /^\s*Traceback\s+\(most recent call last\):/.test(trimmed)
        );
    };

    for (let idx = 0; idx < lines.length; idx += 1) {
        const raw = lines[idx];
        const parsed = parseLogLineAuto(raw);
        const previous = rows[rows.length - 1];
        const canContinuePrevious = (
            Boolean(previous)
            && !parsed
            && raw.trim().length > 0
            && isContinuationLine(raw)
        );

        if (canContinuePrevious && previous) {
            previous.raw = `${previous.raw}\n${raw}`;
            continue;
        }

        rows.push({
            lineNumber: idx + 1,
            raw,
        });
    }

    return rows;
};

const hasActiveFilters = (filters: LogFilters): boolean => {
    for (const value of Object.values(filters)) {
        if (!value) continue;
        if (Array.isArray(value) && value.length > 0) return true;
        if (typeof value === 'object' && 'value' in value) {
            if (value.value && value.value.trim().length > 0) return true;
        }
        if (typeof value === 'object' && ('start' in value || 'end' in value)) {
            if (value.start || value.end) return true;
        }
    }
    return false;
};

const ViewLogsPage: React.FC = () => {
    const [selectedLine, setSelectedLine] = useState<number | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [viewMode, setViewMode] = useState<ViewModeEnum>(ViewModeEnum.FromEnd);

    const dispatch = useDispatch();

    // Get data from Redux
    const {
        content,
        name: fileName,
        format,
        isMonitoring,
        hasFileHandle,
        size: fileSize,
        lastModified,
        isLargeFile,
        analyticsSessionId,
        loaded,
        isIndexing,
    } = useSelector((state: RootState) => state.logFile);

    const {
        regions: anomalyRegions,
        lineNumbers: anomalyLineNumbers,
        hasResults: hasAnomalyResults,
        rowsCount: anomalyRowsCount,
        lastAnalyzedAt: anomalyLastAnalyzedAt,
        lastModelId: anomalyLastModelId,
        lastRunParams: anomalyLastRunParams,
    } = useSelector((state: RootState) => state.anomaly);

    const [isAnomalySnapshotHydrated, setIsAnomalySnapshotHydrated] = useState(false);

    const [normalRows, setNormalRows] = useState<ViewRow[]>([]);
    const [indexedFilteredRows, setIndexedFilteredRows] = useState<ViewRow[]>([]);
    const [isFilterLoading, setIsFilterLoading] = useState<boolean>(false);
    const [indexedHistogramLines, setIndexedHistogramLines] = useState<ViewParsedLine[]>([]);
    const [isHistogramLoading, setIsHistogramLoading] = useState<boolean>(false);
    const [filters, setFilters] = useState<LogFilters>({});
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
    const dbLineCacheRef = useRef<Map<number, DbLineCacheEntry>>(new Map());
    const dbCacheBytesRef = useRef<number>(0);
    const [dbLineCount, setDbLineCount] = useState<number>(0);
    const [dbLineCacheVersion, setDbLineCacheVersion] = useState<number>(0);
    const [serverUploadInProgress, setServerUploadInProgress] = useState(false);
    const [serverUploadProgress, setServerUploadProgress] = useState(0);
    const [virtualWindowStart, setVirtualWindowStart] = useState<number>(0);
    const { getParsedRow, clearParsedRowCache } = useParsedRowsCache();
    const rebaseAnchorRef = useRef<number | null>(null);
    const rangeLoadStateRef = useRef<{ pending: { start: number; end: number } | null; isLoading: boolean }>({
        pending: null,
        isLoading: false,
    });
    const dbRangeLoadStateRef = useRef<{ pending: { start: number; end: number } | null; isLoading: boolean }>({
        pending: null,
        isLoading: false,
    });
    const {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
        handleFileSystemAccessForMonitoring,
    } = useFileLoader();
    const largeFileCacheKey = useMemo(() => {
        return analyticsSessionId || `${fileName}|${fileSize}`;
    }, [analyticsSessionId, fileName, fileSize]);

    const anomalyStorageKey = useMemo(() => {
        if (analyticsSessionId) {
            return analyticsSessionId;
        }

        if (!loaded || !fileName) {
            return '';
        }

        return `file:${fileName}|${fileSize}|${lastModified}`;
    }, [analyticsSessionId, fileName, fileSize, lastModified, loaded]);

    const isRemoteLargeSession = isLargeFile && analyticsSessionId.startsWith('remote:');
    const useStreamView = (isLargeFile && !isRemoteLargeSession) || isIndexing;
    const requiresServerUpload = isLargeFile && !isRemoteLargeSession;

    const useDbView = useMemo(() => {
        return !useStreamView && Boolean(analyticsSessionId);
    }, [analyticsSessionId, useStreamView]);

    const getActiveFile = useCallback(async (): Promise<File | null> => {
        const handle = getFileHandle();
        if (handle) {
            return await handle.getFile();
        }

        return getFileObject();
    }, []);

    useEffect(() => {
        let cancelled = false;
        setIsAnomalySnapshotHydrated(false);

        const loadAnomalySnapshot = async () => {
            if (!anomalyStorageKey) {
                if (!cancelled) {
                    dispatch(clearAnomalyResults());
                    setIsAnomalySnapshotHydrated(true);
                }
                return;
            }

            const snapshot = await getAnomalySnapshot(anomalyStorageKey);
            if (cancelled) {
                return;
            }

            if (snapshot) {
                dispatch(setAnomalyResults({
                    regions: snapshot.regions,
                    lineNumbers: snapshot.lineNumbers,
                    rowsCount: snapshot.rowsCount,
                    analyzedAt: snapshot.analyzedAt,
                    modelId: snapshot.modelId,
                    params: snapshot.params,
                }));
            } else {
                dispatch(clearAnomalyResults());
            }

            setIsAnomalySnapshotHydrated(true);
        };

        void loadAnomalySnapshot();

        return () => {
            cancelled = true;
        };
    }, [anomalyStorageKey, dispatch]);

    useEffect(() => {
        if (!isAnomalySnapshotHydrated || !anomalyStorageKey) {
            return;
        }

        if (!hasAnomalyResults || !anomalyLastAnalyzedAt || !anomalyLastModelId || !anomalyLastRunParams) {
            void deleteAnomalySnapshot(anomalyStorageKey);
            return;
        }

        void saveAnomalySnapshot(anomalyStorageKey, {
            regions: anomalyRegions,
            lineNumbers: anomalyLineNumbers,
            rowsCount: anomalyRowsCount,
            analyzedAt: anomalyLastAnalyzedAt,
            modelId: anomalyLastModelId,
            params: anomalyLastRunParams,
        });
    }, [
        anomalyLastAnalyzedAt,
        anomalyLastModelId,
        anomalyLastRunParams,
        anomalyLineNumbers,
        anomalyRegions,
        anomalyRowsCount,
        anomalyStorageKey,
        hasAnomalyResults,
        isAnomalySnapshotHydrated,
    ]);

    const handleReattachMonitoring = useCallback(async () => {
        if (!analyticsSessionId) return;

        const result = await handleFileSystemAccessForMonitoring(analyticsSessionId, {
            expectedName: fileName,
            expectedSize: fileSize,
            expectedLastModified: lastModifiedRef.current,
            formatHint: format,
            isLargeFile,
        });

        if (result !== 'attached') return;

        const file = await getActiveFile();
        if (!file) return;

        lastModifiedRef.current = file.lastModified;
        lastSizeRef.current = file.size;

        if (!useDbView) return;

        const previousDbLineCount = dbLineCount;
        const appendResult = await appendLogFileToIndex(file, analyticsSessionId);
        if (!appendResult) return;

        setDbLineCount(appendResult.newLineCount);
        if (appendResult.addedLines > 0) {
            setNewLinesCount(appendResult.addedLines);
            setTimeout(() => setNewLinesCount(0), 3000);
        } else if (previousDbLineCount > 0) {
            dbLineCacheRef.current.delete(previousDbLineCount - 1);
            setDbLineCacheVersion((version) => version + 1);
        }
    }, [
        analyticsSessionId,
        dbLineCount,
        fileName,
        fileSize,
        format,
        getActiveFile,
        handleFileSystemAccessForMonitoring,
        isLargeFile,
        useDbView,
    ]);

    const requestFileForAnomalyAnalysis = useCallback(async (): Promise<File | null> => {
        const existing = await getActiveFile();
        if (existing) {
            return existing;
        }

        if (analyticsSessionId) {
            const result = await handleFileSystemAccessForMonitoring(analyticsSessionId, {
                expectedName: fileName,
                expectedSize: fileSize,
                expectedLastModified: lastModifiedRef.current,
                formatHint: format,
                isLargeFile,
            });

            if (result === 'attached' || result === 'switched') {
                return await getActiveFile();
            }

            return null;
        }

        const selected = await handleFileSystemAccess();
        if (!selected) {
            return null;
        }

        return await getActiveFile();
    }, [
        analyticsSessionId,
        fileName,
        fileSize,
        format,
        getActiveFile,
        handleFileSystemAccess,
        handleFileSystemAccessForMonitoring,
        isLargeFile,
    ]);

    const handleUploadToServer = useCallback(async () => {
        if (!requiresServerUpload || serverUploadInProgress) {
            return;
        }

        const file = await getActiveFile();
        if (!file) {
            return;
        }

        setServerUploadInProgress(true);
        setServerUploadProgress(0);
        dispatch(setIndexingState({ isIndexing: true, progress: 0 }));

        try {
            const selectedFormat = getLogFormatById(format);
            const parserPattern = selectedFormat?.patterns?.[0]?.source;
            const started = await startRemoteIngest(file.name, file.size, {
                formatId: format || undefined,
                parserPattern,
            });

            let offset = 0;
            while (offset < file.size) {
                const nextEnd = Math.min(file.size, offset + REMOTE_INGEST_CHUNK_BYTES);
                const chunk = await file.slice(offset, nextEnd).arrayBuffer();
                await uploadRemoteIngestChunk(started.ingest_id, chunk);
                offset = nextEnd;

                const percent = file.size > 0
                    ? Math.min(99, Math.max(0, Math.round((offset / file.size) * 100)))
                    : 0;
                setServerUploadProgress(percent);
                dispatch(setIndexingState({ isIndexing: true, progress: percent }));
            }

            await finishRemoteIngest(started.ingest_id);
            setServerUploadProgress(100);

            dispatch(setLogFile({
                name: fileName,
                size: fileSize,
                format,
                content,
                lastModified,
                hasFileHandle,
                isLargeFile,
                analyticsSessionId: `remote:${started.ingest_id}`,
            }));
        } catch (error) {
            console.error('Failed to upload large file to server:', error);
        } finally {
            dispatch(setIndexingState({ isIndexing: false, progress: 0 }));
            setServerUploadInProgress(false);
        }
    }, [
        content,
        dispatch,
        fileName,
        fileSize,
        format,
        getActiveFile,
        hasFileHandle,
        isLargeFile,
        lastModified,
        requiresServerUpload,
        serverUploadInProgress,
    ]);

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
            // Keep sequential continuation local, but allow external viewport requests
            // to overwrite this range in requestRangeLoad.
            state.pending = nextRange;
        }

        setLineCacheVersion((version) => version + 1);
    }, [getActiveFile]);

    const requestRangeLoad = useCallback((startIndex: number, endIndex: number) => {
        const state = rangeLoadStateRef.current;
        const nextStart = Math.max(0, startIndex - RANGE_LOAD_PADDING);
        const nextEnd = Math.min(endIndex + RANGE_LOAD_PADDING, lineCount - 1);

        if (nextEnd < 0) return;

        // Always prioritize latest viewport request to keep UI responsive on big jumps.
        state.pending = { start: nextStart, end: nextEnd };

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

    const getVirtualWindowSize = useCallback((start: number, total: number): number => {
        if (total <= MAX_VIRTUAL_ROWS) return total;
        const remaining = total - start;
        return Math.max(0, Math.min(MAX_VIRTUAL_ROWS, remaining));
    }, []);

    const clampWindowStart = useCallback((start: number, total: number): number => {
        if (total <= MAX_VIRTUAL_ROWS) return 0;
        const maxStart = total - MAX_VIRTUAL_ROWS;
        return Math.max(0, Math.min(start, maxStart));
    }, []);

    const setWindowAroundDisplayIndex = useCallback((displayIndex: number): number => {
        if (!useStreamView || lineCount <= MAX_VIRTUAL_ROWS) {
            setVirtualWindowStart(0);
            return Math.max(0, Math.min(displayIndex, Math.max(0, lineCount - 1)));
        }

        const desiredStart = clampWindowStart(
            displayIndex - Math.floor(MAX_VIRTUAL_ROWS / 2),
            lineCount,
        );
        const virtualIndex = Math.max(0, displayIndex - desiredStart);

        setVirtualWindowStart(desiredStart);
        return virtualIndex;
    }, [clampWindowStart, lineCount, useStreamView]);

    // Load initial content from Redux
    useEffect(() => {
        if (useStreamView) {
            setNormalRows([]);
            clearParsedRowCache();
            previousLineCountRef.current = 0;
            lastSizeRef.current = fileSize;
            return;
        }

        const safeContent = content ?? "";
        const rows = buildRowsForView(safeContent);
        clearParsedRowCache();
        setNormalRows(rows);
        // Track new lines added
        if (previousLineCountRef.current > 0 && rows.length - previousLineCountRef.current > 0) {
            setNewLinesCount(rows.length - previousLineCountRef.current);
            setTimeout(() => setNewLinesCount(0), 3000);
        }
        previousLineCountRef.current = rows.length;
        lastSizeRef.current = fileSize;
    }, [clearParsedRowCache, content, fileSize, useStreamView]);

    useEffect(() => {
        if (!useDbView || !analyticsSessionId) {
            setDbLineCount(0);
            dbLineCacheRef.current = new Map();
            dbCacheBytesRef.current = 0;
            setDbLineCacheVersion((version) => version + 1);
            return;
        }

        dispatch(clearLogContent());

        let cancelled = false;

        const loadDbLineCount = async () => {
            const count = await getSessionLineCount(analyticsSessionId);
            if (cancelled) return;
            setDbLineCount(count);
            dbLineCacheRef.current = new Map();
            dbCacheBytesRef.current = 0;
            setDbLineCacheVersion((version) => version + 1);
        };

        void loadDbLineCount();

        return () => {
            cancelled = true;
        };
    }, [analyticsSessionId, useDbView]);

    useEffect(() => {
        if (useStreamView || !analyticsSessionId || !hasActiveFilters(filters)) {
            setIndexedFilteredRows([]);
            setIsFilterLoading(false);
            return;
        }

        let cancelled = false;
        const controller = new AbortController();
        let bufferedRows: ViewRow[] = [];
        setIsFilterLoading(true);
        setIndexedFilteredRows([]);

        const flushBufferedRows = () => {
            if (cancelled || bufferedRows.length === 0) {
                return;
            }

            const chunk = bufferedRows;
            bufferedRows = [];
            setIndexedFilteredRows((prev) => {
                if (prev.length >= MAX_INDEXED_FILTER_ROWS) {
                    return prev;
                }
                const available = MAX_INDEXED_FILTER_ROWS - prev.length;
                if (available <= 0) {
                    return prev;
                }
                const toAppend = chunk.slice(0, available);
                if (toAppend.length === 0) {
                    return prev;
                }
                return [...prev, ...toAppend];
            });
        };

        const run = async () => {
            try {
                const result = await queryFilteredLines(analyticsSessionId, filters, {
                    limit: MAX_INDEXED_FILTER_ROWS,
                    signal: controller.signal,
                    onProgress: (partial) => {
                        if (cancelled) return;
                        if (partial.lines.length === 0) return;
                        bufferedRows.push(...partial.lines);
                        if (bufferedRows.length >= FILTER_PROGRESS_UI_BATCH_ROWS) {
                            flushBufferedRows();
                        }
                    },
                });
                if (cancelled) return;
                flushBufferedRows();
                setIndexedFilteredRows((prev) => (
                    prev.length === result.lines.length ? prev : result.lines
                ));
            } catch (error) {
                if ((error as Error).name !== 'AbortError') {
                    console.error('Indexed filter query failed:', error);
                }
            }
        };

        void run().finally(() => {
            if (!cancelled) {
                setIsFilterLoading(false);
            }
        });

        return () => {
            cancelled = true;
            bufferedRows = [];
            controller.abort();
        };
    }, [analyticsSessionId, filters, useStreamView]);

    // Apply filters to lightweight rows using lazy parsing only when needed.
    const filteredRows = useMemo(() => {
        if (useStreamView) {
            return [];
        }

        if (!hasActiveFilters(filters)) {
            if (useDbView) {
                return [];
            }
            return normalRows;
        }

        if (analyticsSessionId) {
            return indexedFilteredRows;
        }

        const parsedRows = normalRows.map((row) => getParsedRow(row));
        const filteredParsed = applyLogFilters(parsedRows, filters);
        return filteredParsed.map((row) => ({ lineNumber: row.lineNumber, raw: row.raw }));
    }, [analyticsSessionId, filters, getParsedRow, indexedFilteredRows, isFilterLoading, normalRows, useDbView, useStreamView]);

    const anomalyLineSet = useMemo(() => {
        return new Set(anomalyLineNumbers);
    }, [anomalyLineNumbers]);

    const displayLines = useMemo(() => {
        if (useStreamView) {
            return [];
        }

        if (useDbView && !hasActiveFilters(filters)) {
            return [];
        }

        if (viewMode === ViewModeEnum.FromEnd) {
            return filteredRows.slice().reverse().map((row) => ({
                raw: row.raw,
                // Preserve source numbering in reverse mode too (including skipped line gaps).
                displayLineNumber: row.lineNumber,
                sourceLineNumber: row.lineNumber,
                anomalyStatus: hasAnomalyResults
                    ? (anomalyLineSet.has(row.lineNumber) ? 'anomaly' as const : 'normal' as const)
                    : undefined,
            }));
        }

        return filteredRows.map((row) => ({
            raw: row.raw,
            displayLineNumber: row.lineNumber,
            sourceLineNumber: row.lineNumber,
            anomalyStatus: hasAnomalyResults
                ? (anomalyLineSet.has(row.lineNumber) ? 'anomaly' as const : 'normal' as const)
                : undefined,
        }));
    }, [anomalyLineSet, filteredRows, hasAnomalyResults, viewMode, filters, useDbView, useStreamView]);

    const loadDbLinesForRange = useCallback(async (startIndex: number, endIndex: number) => {
        if (!analyticsSessionId) return;
        if (dbLineCount === 0) return;

        const start = Math.max(0, startIndex);
        const end = Math.min(endIndex, dbLineCount - 1);
        if (end < start) return;

        const cache = dbLineCacheRef.current;
        let hasMissing = false;
        for (let i = start; i <= end; i += 1) {
            if (!cache.has(i)) {
                hasMissing = true;
                break;
            }
        }
        if (!hasMissing) return;

        const records = await getLinesRange(analyticsSessionId, start + 1, end + 1);

        const touchCacheEntry = (index: number, value: string) => {
            const size = value.length * 2;
            const existing = cache.get(index);
            if (existing) {
                cache.delete(index);
                dbCacheBytesRef.current -= existing.size;
            }
            cache.set(index, { text: value, size });
            dbCacheBytesRef.current += size;
        };

        for (const record of records) {
            touchCacheEntry(record.lineNumber - 1, record.raw);
        }

        while (cache.size > MAX_CACHE_LINES || dbCacheBytesRef.current > MAX_CACHE_BYTES) {
            const oldestKey = cache.keys().next().value as number | undefined;
            if (oldestKey === undefined) break;
            const removed = cache.get(oldestKey);
            cache.delete(oldestKey);
            if (removed) {
                dbCacheBytesRef.current -= removed.size;
            }
        }

        setDbLineCacheVersion((version) => version + 1);
    }, [analyticsSessionId, dbLineCount]);

    const requestDbRangeLoad = useCallback((startIndex: number, endIndex: number) => {
        const state = dbRangeLoadStateRef.current;
        const nextStart = Math.max(0, startIndex - DB_RANGE_LOAD_PADDING);
        const nextEnd = Math.min(endIndex + DB_RANGE_LOAD_PADDING, dbLineCount - 1);

        if (nextEnd < 0) return;

        state.pending = { start: nextStart, end: nextEnd };
        if (state.isLoading) return;

        const run = async () => {
            state.isLoading = true;
            try {
                while (state.pending) {
                    const { start, end } = state.pending;
                    state.pending = null;
                    try {
                        await loadDbLinesForRange(start, end);
                    } catch (error) {
                        console.error('Failed to load DB lines range:', error);
                    }
                }
            } finally {
                state.isLoading = false;
            }
        };

        void run();
    }, [dbLineCount, loadDbLinesForRange]);

    const getDbLineAtIndex = useCallback((displayIndex: number) => {
        if (!useDbView || dbLineCount === 0) return null;

        const fileIndex = viewMode === ViewModeEnum.FromEnd
            ? dbLineCount - 1 - displayIndex
            : displayIndex;

        if (fileIndex < 0 || fileIndex >= dbLineCount) return null;

        const rawEntry = dbLineCacheRef.current.get(fileIndex);

        const displayLineNumber = viewMode === ViewModeEnum.FromEnd
            ? dbLineCount - displayIndex
            : fileIndex + 1;

        return {
            raw: rawEntry?.text ?? 'Loading... ',
            displayLineNumber,
            sourceLineNumber: fileIndex + 1,
            anomalyStatus: hasAnomalyResults
                ? (anomalyLineSet.has(fileIndex + 1) ? 'anomaly' as const : 'normal' as const)
                : undefined,
        };
    }, [anomalyLineSet, dbLineCount, hasAnomalyResults, useDbView, viewMode, dbLineCacheVersion]);

    const getLineAtIndex = useCallback((displayIndex: number) => {
        if (!useStreamView) {
            if (useDbView && !hasActiveFilters(filters)) {
                return getDbLineAtIndex(displayIndex);
            }
            return displayLines[displayIndex] ?? null;
        }

        if (lineCount === 0) return null;

        const globalDisplayIndex = virtualWindowStart + displayIndex;

        const fileIndex = viewMode === ViewModeEnum.FromEnd
            ? lineCount - 1 - globalDisplayIndex
            : globalDisplayIndex;

        if (fileIndex < 0 || fileIndex >= lineCount) return null;

        const rawEntry = lineCacheRef.current.get(fileIndex);

        const displayLineNumber = viewMode === ViewModeEnum.FromEnd
            ? lineCount - globalDisplayIndex
            : fileIndex + 1;

        return {
            raw: rawEntry?.text ?? 'Loading...',
            displayLineNumber,
            sourceLineNumber: fileIndex + 1,
            anomalyStatus: hasAnomalyResults
                ? (anomalyLineSet.has(fileIndex + 1) ? 'anomaly' as const : 'normal' as const)
                : undefined,
        };
    }, [anomalyLineSet, displayLines, hasAnomalyResults, lineCount, viewMode, lineCacheVersion, virtualWindowStart, useStreamView]);

    const handleRangeChange = useCallback((startIndex: number, endIndex: number) => {
        if (!useStreamView || lineCount === 0) return;

        const virtualCount = getVirtualWindowSize(virtualWindowStart, lineCount);
        const safeStart = Math.max(0, Math.min(startIndex, Math.max(0, virtualCount - 1)));
        const safeEnd = Math.max(0, Math.min(endIndex, Math.max(0, virtualCount - 1)));
        const globalStart = virtualWindowStart + safeStart;
        const globalEnd = virtualWindowStart + safeEnd;

        const mappedStart = viewMode === ViewModeEnum.FromEnd
            ? lineCount - 1 - globalEnd
            : globalStart;
        const mappedEnd = viewMode === ViewModeEnum.FromEnd
            ? lineCount - 1 - globalStart
            : globalEnd;

        requestRangeLoad(mappedStart, mappedEnd);

        if (lineCount <= MAX_VIRTUAL_ROWS) return;

        const nearTop = safeStart < WINDOW_REBASE_MARGIN;
        const nearBottom = safeEnd > Math.max(0, virtualCount - 1 - WINDOW_REBASE_MARGIN);

        if (!nearTop && !nearBottom) return;

        const globalAnchor = Math.floor((globalStart + globalEnd) / 2);
        const nextWindowStart = clampWindowStart(
            globalAnchor - Math.floor(MAX_VIRTUAL_ROWS / 2),
            lineCount,
        );

        if (nextWindowStart === virtualWindowStart) return;

        rebaseAnchorRef.current = Math.max(0, globalAnchor - nextWindowStart);
        setVirtualWindowStart(nextWindowStart);
    }, [
        clampWindowStart,
        getVirtualWindowSize,
        lineCount,
        requestRangeLoad,
        viewMode,
        virtualWindowStart,
        useStreamView,
    ]);

    const handleDbRangeChange = useCallback((startIndex: number, endIndex: number) => {
        if (!useDbView || hasActiveFilters(filters) || dbLineCount === 0) return;
        const safeStart = Math.max(0, startIndex);
        const safeEnd = Math.max(0, Math.min(endIndex, Math.max(0, dbLineCount - 1)));
        if (viewMode === ViewModeEnum.FromEnd) {
            const mappedStart = dbLineCount - 1 - safeEnd;
            const mappedEnd = dbLineCount - 1 - safeStart;
            requestDbRangeLoad(mappedStart, mappedEnd);
        } else {
            requestDbRangeLoad(safeStart, safeEnd);
        }
    }, [dbLineCount, filters, requestDbRangeLoad, useDbView, viewMode]);

    useEffect(() => {
        if (!useDbView || hasActiveFilters(filters) || dbLineCount === 0) {
            return;
        }

        const end = Math.min(DB_RANGE_LOAD_PADDING, dbLineCount - 1);
        if (viewMode === ViewModeEnum.FromEnd) {
            const mappedStart = Math.max(0, dbLineCount - 1 - end);
            const mappedEnd = dbLineCount - 1;
            requestDbRangeLoad(mappedStart, mappedEnd);
        } else {
            requestDbRangeLoad(0, end);
        }
    }, [dbLineCount, filters, requestDbRangeLoad, useDbView, viewMode]);

    useEffect(() => {
        if (useStreamView || !analyticsSessionId || isIndexing) {
            setIndexedHistogramLines([]);
            setIsHistogramLoading(false);
            return;
        }

        let cancelled = false;
        setIsHistogramLoading(true);

        const loadHistogramSample = async () => {
            const snapshot = await getDashboardSnapshot(analyticsSessionId);
            if (cancelled) return;
            setIndexedHistogramLines(snapshot?.sampledLines ?? []);
        };

        void loadHistogramSample().finally(() => {
            if (!cancelled) {
                setIsHistogramLoading(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [analyticsSessionId, isIndexing, useStreamView]);

    const histogramSourceLines = useMemo(() => {
        if (useStreamView) {
            return [];
        }

        return indexedHistogramLines;
    }, [indexedHistogramLines, useStreamView]);

    const handleAnomalyRangeSelect = useCallback((startLine: number, endLine: number) => {
        const normalizedStart = Math.min(startLine, endLine);
        const normalizedEnd = Math.max(startLine, endLine);
        // In start mode jump to range start; in end mode jump to range end.
        const targetSourceLine = viewMode === ViewModeEnum.FromEnd ? normalizedEnd : normalizedStart;

        if (targetSourceLine <= 0 || !Number.isFinite(targetSourceLine)) {
            return;
        }

        if (useStreamView) {
            if (!virtuosoRef.current || lineCount <= 0) return;

            const fileIndex = Math.max(0, Math.min(lineCount - 1, Math.floor(targetSourceLine) - 1));
            const globalDisplayIndex = viewMode === ViewModeEnum.FromEnd
                ? Math.max(0, lineCount - 1 - fileIndex)
                : fileIndex;

            const currentVirtualCount = getVirtualWindowSize(virtualWindowStart, lineCount);
            const localIndexInCurrentWindow = globalDisplayIndex - virtualWindowStart;
            const isInsideCurrentWindow =
                localIndexInCurrentWindow >= 0 && localIndexInCurrentWindow < currentVirtualCount;

            if (isInsideCurrentWindow) {
                rebaseAnchorRef.current = null;
                setSelectedLine(Math.floor(targetSourceLine));
                virtuosoRef.current.scrollToIndex({
                    index: localIndexInCurrentWindow,
                    align: 'center',
                    behavior: 'auto',
                });
                return;
            }

            const targetIndex = setWindowAroundDisplayIndex(globalDisplayIndex);
            rebaseAnchorRef.current = targetIndex;
            setSelectedLine(Math.floor(targetSourceLine));
            return;
        }

        if (!virtuosoRef.current || displayLines.length === 0) return;

        let targetIndex = displayLines.findIndex((line) => line.sourceLineNumber === targetSourceLine);
        if (targetIndex < 0) {
            let bestIndex = -1;
            let bestDistance = Number.POSITIVE_INFINITY;
            let bestSource = Number.NaN;

            for (let i = 0; i < displayLines.length; i += 1) {
                const source = displayLines[i].sourceLineNumber ?? displayLines[i].displayLineNumber;
                if (!Number.isFinite(source)) {
                    continue;
                }

                const distance = Math.abs(source - targetSourceLine);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                    bestSource = source;
                    continue;
                }

                if (distance === bestDistance) {
                    const preferCurrent = viewMode === ViewModeEnum.FromEnd
                        ? source > bestSource
                        : source < bestSource;
                    if (preferCurrent) {
                        bestIndex = i;
                        bestSource = source;
                    }
                }
            }

            targetIndex = bestIndex;
        }

        if (targetIndex < 0) {
            return;
        }

        const targetLine = displayLines[targetIndex];
        setSelectedLine(targetLine.displayLineNumber);
        virtuosoRef.current.scrollToIndex({ index: targetIndex, align: 'center', behavior: 'auto' });
    }, [
        displayLines,
        getVirtualWindowSize,
        lineCount,
        setWindowAroundDisplayIndex,
        viewMode,
        virtualWindowStart,
        useStreamView,
    ]);

    // Get field definitions from detected format for filter configuration
    const fieldDefinitions = useMemo((): LogFormatField[] => {
        if (format) {
            const fields = getFormatFields(format);
            if (fields.length > 0) {
                return fields;
            }
        }

        if (content) {
            const formatId = detectLogFormat(content);
            if (formatId) {
                return getFormatFields(formatId);
            }
        }

        return [];
    }, [content, format]);

    useEffect(() => {
        if (!useStreamView) return;

        const cached = largeFileViewCache.get(largeFileCacheKey);
        if (cached) {
            lineOffsetsRef.current = cached.lineOffsets;
            setLineCount(cached.lineCount);

            lineCacheRef.current = new Map();
            cacheBytesRef.current = 0;
            setLineCacheVersion((version) => version + 1);

            if (cached.lineCount > 0) {
                if (viewMode === ViewModeEnum.FromEnd) {
                    const start = Math.max(0, cached.lineCount - 1 - RANGE_LOAD_PADDING);
                    requestRangeLoad(start, cached.lineCount - 1);
                } else {
                    requestRangeLoad(0, Math.min(RANGE_LOAD_PADDING, cached.lineCount - 1));
                }
            }

            return;
        }

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
            setLargeFileViewCache(largeFileCacheKey, {
                lineOffsets: offsets,
                lineCount: offsets.length,
            });

            if (offsets.length > 0) {
                if (viewMode === ViewModeEnum.FromEnd) {
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
    }, [buildLineIndex, getActiveFile, largeFileCacheKey, requestRangeLoad, useStreamView, viewMode]);

    useEffect(() => {
        if (!useStreamView || lineCount === 0) return;

        if (viewMode === ViewModeEnum.FromEnd) {
            const start = Math.max(0, lineCount - 1 - RANGE_LOAD_PADDING);
            requestRangeLoad(start, lineCount - 1);
        } else {
            requestRangeLoad(0, Math.min(RANGE_LOAD_PADDING, lineCount - 1));
        }
    }, [lineCount, requestRangeLoad, useStreamView, viewMode]);

    useEffect(() => {
        if (!useStreamView) {
            setVirtualWindowStart(0);
            return;
        }

        setVirtualWindowStart((current) => clampWindowStart(current, lineCount));
    }, [clampWindowStart, lineCount, useStreamView]);

    useEffect(() => {
        if (!useStreamView) return;
        if (rebaseAnchorRef.current === null) return;
        if (!virtuosoRef.current) return;

        const virtualCount = getVirtualWindowSize(virtualWindowStart, lineCount);
        if (virtualCount <= 0) return;

        const anchor = Math.max(0, Math.min(rebaseAnchorRef.current, virtualCount - 1));
        virtuosoRef.current.scrollToIndex({ index: anchor, align: 'center', behavior: 'auto' });
        rebaseAnchorRef.current = null;
    }, [getVirtualWindowSize, lineCount, useStreamView, virtualWindowStart]);

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

                            if (useStreamView) {
                                if (currentSize < lastSizeRef.current) {
                                    console.log('File truncated, rebuilding index');
                                    const offsets = await buildLineIndex(file);
                                    lineOffsetsRef.current = offsets;
                                    lineCacheRef.current = new Map();
                                    cacheBytesRef.current = 0;
                                    setLineCacheVersion((version) => version + 1);
                                    setLineCount(offsets.length);
                                    lastSizeRef.current = currentSize;
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

                                    if (viewMode === ViewModeEnum.FromEnd && offsets.length > 0) {
                                        const start = Math.max(0, offsets.length - 1 - RANGE_LOAD_PADDING);
                                        requestRangeLoad(start, offsets.length - 1);
                                    }
                                } else {
                                    console.log('File modified but size unchanged, skipping update');
                                }

                                return;
                            }

                            const preview = await file.slice(0, Math.min(file.size, PREVIEW_BYTES)).text();
                            if (useDbView && analyticsSessionId) {
                                const previousDbLineCount = dbLineCount;
                                const result = await appendLogFileToIndex(file, analyticsSessionId);
                                if (result) {
                                    setDbLineCount(result.newLineCount);
                                    if (result.addedLines > 0) {
                                        setNewLinesCount(result.addedLines);
                                        setTimeout(() => setNewLinesCount(0), 3000);
                                    } else if (previousDbLineCount > 0) {
                                        dbLineCacheRef.current.delete(previousDbLineCount - 1);
                                        setDbLineCacheVersion((version) => version + 1);
                                    }
                                }

                                dispatch(updateLogContent({
                                    content,
                                    lastModified: file.lastModified,
                                    size: currentSize,
                                }));
                            } else {
                                dispatch(updateLogContent({
                                    content: preview,
                                    lastModified: file.lastModified,
                                    size: currentSize,
                                }));
                            }

                            lastSizeRef.current = currentSize;
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
    }, [
        analyticsSessionId,
        autoRefresh,
        buildLineIndex,
        content,
        dbLineCount,
        dispatch,
        hasFileHandle,
        isMonitoring,
        requestRangeLoad,
        useDbView,
        useStreamView,
        viewMode,
    ]);

    const handleToggleAutoRefresh = () => {
        setAutoRefresh(prev => !prev);
    };

    const handleManualRefresh = async () => {
        const fileHandle = getFileHandle();
        if (!fileHandle && !useStreamView) return;

        try {
            if (useStreamView) {
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
                if (offsets.length > 0) {
                    if (viewMode === ViewModeEnum.FromEnd) {
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
            const newContent = await file.slice(0, Math.min(file.size, PREVIEW_BYTES)).text();

            dispatch(updateLogContent({
                content: newContent,
                lastModified: file.lastModified,
                size: file.size,
            }));

        } catch (error) {
            console.error('Error refreshing file:', error);
        }
    };

    if (!isMonitoring && !loaded) {
        return (
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
            {useDbView && !hasFileHandle && !isRemoteLargeSession && (
                <Box
                    sx={{
                        mb: 1,
                        p: 2,
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        backgroundColor: (theme) => theme.palette.background.paper,
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 2,
                    }}
                >
                    <Typography
                        variant="body2"
                        color="text.secondary"
                    >
                        Для отслеживания новых строк выберите тот же файл снова.
                    </Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => void handleReattachMonitoring()}
                    >
                        Выбрать файл для мониторинга
                    </Button>
                </Box>
            )}
            {/* Log Timeline Histogram */}
            {(isIndexing || isHistogramLoading) && !isLargeFile && (
                <Box
                    sx={{
                        height: 150,
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        backgroundColor: (theme) => theme.palette.background.paper,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        px: 2,
                    }}
                >
                    <CircularProgress size={24} />
                    <Typography
                        variant="body2"
                        color="text.secondary"
                    >
                        Индексация завершится — появится график.
                    </Typography>
                </Box>
            )}
            {!isIndexing && !isHistogramLoading && histogramSourceLines.length > 0 && (
                <LogHistogram
                    parsedLines={histogramSourceLines}
                    defaultCollapsed={false}
                    height={150}
                    anomalyRegions={anomalyRegions}
                    anomalyLineNumbers={anomalyLineNumbers}
                    onAnomalyRangeSelect={handleAnomalyRangeSelect}
                />
            )}

            <LogToolbar
                onManualRefresh={handleManualRefresh}
                autoRefresh={autoRefresh}
                onToggleAutoRefresh={handleToggleAutoRefresh}
                onUploadToServer={requiresServerUpload ? () => void handleUploadToServer() : undefined}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                newLinesCount={newLinesCount}
                filters={filters}
                onFiltersChange={setFilters}
                fieldDefinitions={fieldDefinitions}
                isStreamView={useStreamView}
                filtersDisabled={isIndexing || serverUploadInProgress}
                lineCount={lineCount}
                normalRows={normalRows}
                requestFileForAnomalyAnalysis={requestFileForAnomalyAnalysis}
                remoteIngestId={isRemoteLargeSession ? analyticsSessionId.replace('remote:', '') : undefined}
                showUploadToServer={requiresServerUpload}
                uploadInProgress={serverUploadInProgress}
                uploadProgress={serverUploadProgress}
                fileActionsDisabled={requiresServerUpload}
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
                    totalCount={useStreamView
                        ? getVirtualWindowSize(virtualWindowStart, lineCount)
                        : (useDbView && !hasActiveFilters(filters) ? dbLineCount : displayLines.length)
                    }
                    getLineAtIndex={getLineAtIndex}
                    onRangeChange={useStreamView ? handleRangeChange : (useDbView ? handleDbRangeChange : undefined)}
                    selectedLine={selectedLine}
                    onSelectLine={setSelectedLine}
                    virtuosoRef={virtuosoRef}
                />
            </Box>
        </Box>
    );
}
export default ViewLogsPage;