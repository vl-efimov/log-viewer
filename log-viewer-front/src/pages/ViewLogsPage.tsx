import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { VirtuosoHandle } from 'react-virtuoso';
import { RootState } from '../redux/store';
import {
    updateLogContent,
    appendLogContent,
    setAnomalyResults,
    setAnomalyError,
    setAnomalyRunning,
    setAnomalyLastDurationSec,
    updateAnomalyRowsPerSecond,
    clearAnomalyResults,
    setMonitoringState,
} from '../redux/slices/logFileSlice';
import { getFileHandle, getFileObject } from '../redux/slices/logFileSlice';
import { getFormatFields, detectLogFormat, parseLogLineAuto, type LogFormatField, type ParsedLogLine } from '../utils/logFormatDetector';
import { LogFiltersBar } from '../components/LogFiltersBar';
import { LogHistogram } from '../components/LogHistogram';
import type { LogFilters } from '../types/filters';
import { applyLogFilters, getFilteredCount } from '../utils/logFilters';
import { FileSelectionView } from '../components/FileSelectionView';
import { useFileLoader } from '../hooks/useFileLoader';
import { useParsedRowsCache } from '../hooks/useParsedRowsCache';
import LogLinesList from '../components/LogLinesList';
import LogToolbar from '../components/LogToolbar';
import { sampleAndAnalyzeLargeFile } from '../utils/histogramSampling';
import { isBglModelReady, predictBglAnomalies, predictBglAnomaliesFromFile } from '../services/bglAnomalyApi';
import {
    ANOMALY_SETTINGS_DEFAULTS,
    ANOMALY_STEP_SIZE_RANGE,
    ANOMALY_THRESHOLD_RANGE,
    ANOMALY_MIN_REGION_LINES_RANGE,
    type AnomalySettings,
    loadAnomalySettings,
    loadSelectedAnomalyModelId,
    saveAnomalySettings,
    saveSelectedAnomalyModelId,
} from '../utils/anomalySettings';

const LINE_INDEX_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB
const LINE_INDEX_CHUNK_SIZE = 1_000_000; // Offsets per chunk
const RANGE_LOAD_PADDING = 60;
const MAX_CACHE_LINES = 500;
const MAX_CACHE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_RANGE_BYTES = 512 * 1024; // 512 KB
const MAX_VIRTUAL_ROWS = 1_500_000;
const WINDOW_REBASE_MARGIN = 200_000;
const MAX_LARGE_FILE_VIEW_CACHE_ENTRIES = 3;
const MAX_NORMAL_HISTOGRAM_SAMPLE_LINES = 50_000;

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
    histogramLines: ViewParsedLine[];
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
            if (Boolean(value.value && value.value.trim().length > 0)) return true;
        }
        if (typeof value === 'object' && ('start' in value || 'end' in value)) {
            if (Boolean(value.start || value.end)) return true;
        }
    }
    return false;
};

const ViewLogsPage: React.FC = () => {
    const [selectedLine, setSelectedLine] = useState<number | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [viewMode, setViewMode] = useState<'live-tail' | 'normal'>('live-tail');

    const dispatch = useDispatch();
    
    // Get data from Redux
    const {
        content,
        name: fileName,
        format,
        isMonitoring,
        hasFileHandle,
        size: fileSize,
        isLargeFile,
        analyticsSessionId,
        anomalyRegions,
        anomalyLineNumbers,
        hasAnomalyResults,
        anomalyIsRunning,
        anomalyRowsPerSecondByModel,
    } = useSelector((state: RootState) => state.logFile);

    const [normalRows, setNormalRows] = useState<ViewRow[]>([]);
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
    const [virtualWindowStart, setVirtualWindowStart] = useState<number>(0);
    const [isHistogramLoading, setIsHistogramLoading] = useState<boolean>(false);
    const [histogramProgress, setHistogramProgress] = useState<number>(0);
    const [largeFileHistogramLines, setLargeFileHistogramLines] = useState<ViewParsedLine[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<'bgl' | 'hdfs'>(() => loadSelectedAnomalyModelId());
    const [anomalySettings, setAnomalySettings] = useState<AnomalySettings>(() => loadAnomalySettings(loadSelectedAnomalyModelId()));
    const [isAnomalySettingsPanelOpen, setIsAnomalySettingsPanelOpen] = useState<boolean>(false);
    const [isModelReady, setIsModelReady] = useState<boolean>(false);
    const [isModelReadyLoading, setIsModelReadyLoading] = useState<boolean>(false);
    const { getParsedRow, clearParsedRowCache } = useParsedRowsCache();
    const rebaseAnchorRef = useRef<number | null>(null);
    const rangeLoadStateRef = useRef<{ pending: { start: number; end: number } | null; isLoading: boolean }>({
        pending: null,
        isLoading: false,
    });
    const {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
    } = useFileLoader();
    const largeFileCacheKey = useMemo(() => {
        return analyticsSessionId || `${fileName}|${fileSize}`;
    }, [analyticsSessionId, fileName, fileSize]);

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
        if (!isLargeFile || lineCount <= MAX_VIRTUAL_ROWS) {
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
    }, [clampWindowStart, isLargeFile, lineCount]);

    const scrollToBottom = () => {
        if (virtuosoRef.current) {
            const totalDisplayCount = isLargeFile
                ? getVirtualWindowSize(virtualWindowStart, lineCount)
                : displayLines.length;
            if (totalDisplayCount > 0) {
                let targetIndex = viewMode === 'live-tail' ? 0 : totalDisplayCount - 1;

                if (isLargeFile) {
                    const globalTarget = viewMode === 'live-tail' ? 0 : Math.max(0, lineCount - 1);
                    targetIndex = setWindowAroundDisplayIndex(globalTarget);
                    rebaseAnchorRef.current = targetIndex;
                }

                virtuosoRef.current.scrollToIndex({
                    index: targetIndex,
                    align: viewMode === 'live-tail' ? 'start' : 'end',
                    behavior: 'auto'
                });
            }
        }
    };

    // Load initial content from Redux
    useEffect(() => {
        if (isLargeFile) {
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
        setLastUpdate(new Date());
        // Track new lines added
        if (previousLineCountRef.current > 0 && rows.length - previousLineCountRef.current > 0) {
            setNewLinesCount(rows.length - previousLineCountRef.current);
            setTimeout(() => setNewLinesCount(0), 3000);
        }
        previousLineCountRef.current = rows.length;
        lastSizeRef.current = fileSize;
    }, [clearParsedRowCache, content, fileSize, isLargeFile]);

    // Apply filters to lightweight rows using lazy parsing only when needed.
    const filteredRows = useMemo(() => {
        if (isLargeFile) {
            return [];
        }

        if (!hasActiveFilters(filters)) {
            return normalRows;
        }

        const parsedRows = normalRows.map((row) => getParsedRow(row));
        const filteredParsed = applyLogFilters(parsedRows, filters);
        return filteredParsed.map((row) => ({ lineNumber: row.lineNumber, raw: row.raw }));
    }, [filters, getParsedRow, isLargeFile, normalRows]);

    const anomalyLineSet = useMemo(() => {
        return new Set(anomalyLineNumbers);
    }, [anomalyLineNumbers]);

    const displayLines = useMemo(() => {
        if (isLargeFile) {
            return [];
        }

        if (viewMode === 'live-tail') {
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
    }, [anomalyLineSet, filteredRows, hasAnomalyResults, viewMode, isLargeFile]);

    const getLineAtIndex = useCallback((displayIndex: number) => {
        if (!isLargeFile) {
            return displayLines[displayIndex] ?? null;
        }

        if (lineCount === 0) return null;

        const globalDisplayIndex = virtualWindowStart + displayIndex;

        const fileIndex = viewMode === 'live-tail'
            ? lineCount - 1 - globalDisplayIndex
            : globalDisplayIndex;

        if (fileIndex < 0 || fileIndex >= lineCount) return null;

        const rawEntry = lineCacheRef.current.get(fileIndex);

        const displayLineNumber = viewMode === 'live-tail'
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
    }, [anomalyLineSet, displayLines, hasAnomalyResults, isLargeFile, lineCount, viewMode, lineCacheVersion, virtualWindowStart]);

    const handleRangeChange = useCallback((startIndex: number, endIndex: number) => {
        if (!isLargeFile || lineCount === 0) return;

        const virtualCount = getVirtualWindowSize(virtualWindowStart, lineCount);
        const safeStart = Math.max(0, Math.min(startIndex, Math.max(0, virtualCount - 1)));
        const safeEnd = Math.max(0, Math.min(endIndex, Math.max(0, virtualCount - 1)));
        const globalStart = virtualWindowStart + safeStart;
        const globalEnd = virtualWindowStart + safeEnd;

        const mappedStart = viewMode === 'live-tail'
            ? lineCount - 1 - globalEnd
            : globalStart;
        const mappedEnd = viewMode === 'live-tail'
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
        isLargeFile,
        lineCount,
        requestRangeLoad,
        viewMode,
        virtualWindowStart,
    ]);

    const histogramSourceLines = useMemo(() => {
        if (isLargeFile) {
            return largeFileHistogramLines;
        }

        if (normalRows.length === 0) {
            return [];
        }

        const step = Math.max(1, Math.ceil(normalRows.length / MAX_NORMAL_HISTOGRAM_SAMPLE_LINES));
        const sampled: ViewParsedLine[] = [];
        for (let i = 0; i < normalRows.length; i += step) {
            sampled.push(getParsedRow(normalRows[i]));
        }

        return sampled;
    }, [getParsedRow, isLargeFile, largeFileHistogramLines, normalRows]);

    const handleAnomalyRangeSelect = useCallback((startLine: number, endLine: number) => {
        const normalizedStart = Math.min(startLine, endLine);
        const normalizedEnd = Math.max(startLine, endLine);
        // In normal mode jump to range start; in live-tail jump to range end.
        const targetSourceLine = viewMode === 'live-tail' ? normalizedEnd : normalizedStart;

        if (targetSourceLine <= 0 || !Number.isFinite(targetSourceLine)) {
            return;
        }

        if (isLargeFile) {
            if (!virtuosoRef.current || lineCount <= 0) return;

            const fileIndex = Math.max(0, Math.min(lineCount - 1, Math.floor(targetSourceLine) - 1));
            const globalDisplayIndex = viewMode === 'live-tail'
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
                    const preferCurrent = viewMode === 'live-tail'
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
        isLargeFile,
        lineCount,
        setWindowAroundDisplayIndex,
        viewMode,
        virtualWindowStart,
    ]);

    useEffect(() => {
        if (!isMonitoring) {
            dispatch(clearAnomalyResults());
            dispatch(setAnomalyRunning({ running: false }));
        }
    }, [dispatch, isMonitoring]);

    useEffect(() => {
        if (!isMonitoring) {
            setIsModelReady(false);
            setIsModelReadyLoading(false);
            return;
        }

        let cancelled = false;

        const checkModelReady = async () => {
            setIsModelReadyLoading(true);
            try {
                const ready = await isBglModelReady(selectedModelId);
                if (!cancelled) {
                    setIsModelReady(ready);
                }
            } catch {
                if (!cancelled) {
                    setIsModelReady(false);
                }
            } finally {
                if (!cancelled) {
                    setIsModelReadyLoading(false);
                }
            }
        };

        void checkModelReady();

        return () => {
            cancelled = true;
        };
    }, [isMonitoring, selectedModelId]);

    const handleSelectedModelChange = useCallback((modelId: 'bgl' | 'hdfs') => {
        setSelectedModelId(modelId);
        saveSelectedAnomalyModelId(modelId);
        setIsAnomalySettingsPanelOpen(true);
    }, []);

    useEffect(() => {
        setAnomalySettings(loadAnomalySettings(selectedModelId));
    }, [selectedModelId]);

    const updateAnomalySettings = useCallback((patch: Partial<AnomalySettings>) => {
        setAnomalySettings((prev) => {
            const next: AnomalySettings = {
                ...prev,
                ...patch,
                modelId: selectedModelId,
            };
            saveAnomalySettings(next);
            return next;
        });
    }, [selectedModelId]);

    const applySensitivityProfile = useCallback((profileId: 'sensitive' | 'balanced' | 'strict') => {
        const profiles: Record<'sensitive' | 'balanced' | 'strict', Pick<AnomalySettings, 'threshold' | 'stepSize' | 'minRegionLines'>> = {
            sensitive: { threshold: 0.35, stepSize: 5, minRegionLines: 1 },
            balanced: { threshold: 0.5, stepSize: 10, minRegionLines: 2 },
            strict: { threshold: 0.7, stepSize: 20, minRegionLines: 3 },
        };
        updateAnomalySettings(profiles[profileId]);
    }, [updateAnomalySettings]);

    const resetAnomalySettings = useCallback(() => {
        const reset: AnomalySettings = {
            ...ANOMALY_SETTINGS_DEFAULTS,
            modelId: selectedModelId,
        };
        setAnomalySettings(reset);
        saveAnomalySettings(reset);
    }, [selectedModelId]);

    const runAnomalyAnalysis = useCallback(async () => {
        if (!isModelReady) {
            dispatch(setAnomalyError('Model is not prepared. Open Pretrained Models and click Prepare Model.'));
            return;
        }

        if (!isLargeFile && normalRows.length === 0) {
            dispatch(setAnomalyError('No parsed lines to analyze.'));
            return;
        }

        const runStartedAt = Date.now();
        dispatch(setAnomalyError(''));

        try {
            const settings = anomalySettings;
            const useFilteredScope = !isLargeFile && settings.analysisScope === 'filtered';
            const sourceRows = useFilteredScope ? filteredRows : normalRows;
            const sourceLineNumbers = sourceRows.map((line) => line.lineNumber);

            const rowsToAnalyze = isLargeFile
                ? Math.max(0, lineCount)
                : sourceRows.length;

            const rowsPerSecond = anomalyRowsPerSecondByModel[selectedModelId];
            const expectedDurationSec = rowsPerSecond && rowsPerSecond > 0
                ? Math.max(1, Math.round(rowsToAnalyze / rowsPerSecond))
                : null;

            dispatch(setAnomalyRunning({
                running: true,
                startedAt: runStartedAt,
                expectedDurationSec,
            }));

            if (!isLargeFile && sourceRows.length === 0) {
                dispatch(setAnomalyError('No lines in selected analysis scope.'));
                dispatch(clearAnomalyResults());
                return;
            }

            const result = isLargeFile
                ? await (async () => {
                    const activeFile = await getActiveFile();
                    if (!activeFile) {
                        throw new Error('Failed to access file for anomaly analysis.');
                    }

                    return predictBglAnomaliesFromFile(activeFile, {
                        model_id: selectedModelId,
                        text_column: 'message',
                        timestamp_column: settings.timestampColumn === 'auto' ? undefined : settings.timestampColumn,
                        threshold: settings.threshold,
                        step_size: settings.stepSize,
                        min_region_lines: settings.minRegionLines,
                        include_rows: false,
                        include_windows: false,
                    });
                })()
                : await (async () => {
                    const rows = sourceRows.map((line) => {
                        const parsedLine = getParsedRow(line);
                        const normalizedTimestamp = parsedLine.parsed?.fields.timestamp
                            || parsedLine.parsed?.fields.datetime
                            || (parsedLine.parsed?.fields.date && parsedLine.parsed?.fields.time
                                ? `${parsedLine.parsed.fields.date} ${parsedLine.parsed.fields.time}`
                                : null);

                        const row: {
                            message: string;
                            timestamp?: string | null;
                            datetime?: string | null;
                            time?: string | null;
                            date?: string | null;
                            event_time?: string | null;
                            created_at?: string | null;
                        } = {
                            message: line.raw,
                            timestamp: normalizedTimestamp,
                        };

                        if (settings.timestampColumn !== 'auto') {
                            row[settings.timestampColumn] = parsedLine.parsed?.fields[settings.timestampColumn] ?? null;
                        }

                        return row;
                    });

                    return predictBglAnomalies({
                        model_id: selectedModelId,
                        rows,
                        text_column: 'message',
                        timestamp_column: settings.timestampColumn === 'auto' ? undefined : settings.timestampColumn,
                        threshold: settings.threshold,
                        step_size: settings.stepSize,
                        min_region_lines: settings.minRegionLines,
                        include_rows: false,
                        include_windows: false,
                    });
                })();

            const mappedRegions = isLargeFile
                ? result.anomaly_regions
                : result.anomaly_regions.map((region) => {
                    const mappedStart = sourceLineNumbers[region.start_line - 1];
                    const mappedEnd = sourceLineNumbers[region.end_line - 1];
                    return {
                        ...region,
                        start_line: Number.isFinite(mappedStart) ? mappedStart : region.start_line,
                        end_line: Number.isFinite(mappedEnd) ? mappedEnd : region.end_line,
                    };
                });

            const anomalyRowLines = Array.isArray(result.anomaly_lines)
                ? result.anomaly_lines
                : (result.rows ?? [])
                    .filter((row) => row.is_anomaly)
                    .map((row) => row.line);

            const anomalyLineNumbers = isLargeFile
                ? anomalyRowLines
                    .filter((lineNumber): lineNumber is number => typeof lineNumber === 'number' && Number.isFinite(lineNumber))
                : anomalyRowLines
                    .map((line) => sourceLineNumbers[line - 1])
                    .filter((lineNumber): lineNumber is number => typeof lineNumber === 'number' && Number.isFinite(lineNumber));

            dispatch(setAnomalyResults({
                regions: mappedRegions,
                lineNumbers: anomalyLineNumbers,
                rowsCount: result.meta.anomaly_rows,
                analyzedAt: Date.now(),
                modelId: selectedModelId,
                params: {
                    threshold: settings.threshold,
                    stepSize: settings.stepSize,
                    minRegionLines: settings.minRegionLines,
                        analysisScope: useFilteredScope ? settings.analysisScope : 'all',
                    timestampColumn: settings.timestampColumn,
                },
            }));
        } catch (err) {
            dispatch(clearAnomalyResults());
            dispatch(setAnomalyError(err instanceof Error ? err.message : 'Anomaly analysis failed'));
        } finally {
            const elapsedSec = Math.max(1, Math.round((Date.now() - runStartedAt) / 1000));
            dispatch(setAnomalyLastDurationSec(elapsedSec));

            const settings = anomalySettings;
            const useFilteredScope = !isLargeFile && settings.analysisScope === 'filtered';
            const sourceRows = useFilteredScope ? filteredRows : normalRows;
            const analyzedRows = isLargeFile ? Math.max(0, lineCount) : sourceRows.length;
            if (analyzedRows > 0) {
                const measuredRowsPerSecond = analyzedRows / elapsedSec;
                dispatch(updateAnomalyRowsPerSecond({
                    modelId: selectedModelId,
                    rowsPerSecond: measuredRowsPerSecond,
                }));
            }

            dispatch(setAnomalyRunning({ running: false }));
        }
    }, [anomalyRowsPerSecondByModel, anomalySettings, dispatch, filteredRows, getActiveFile, getParsedRow, isLargeFile, isModelReady, lineCount, normalRows, selectedModelId]);

    const canRunAnomalyAnalysis = !isModelReadyLoading && isModelReady;
    const anomalyDisabledReason = isModelReadyLoading
            ? 'Checking model readiness...'
            : isModelReady
                ? undefined
                : `Prepare selected model (${selectedModelId.toUpperCase()}) in Pretrained Models first.`;

    // Get filter statistics
    const filterStats = useMemo(() => {
        if (isLargeFile) {
            return { total: lineCount, filtered: lineCount, parsedFiltered: 0 };
        }

        if (!hasActiveFilters(filters)) {
            return { total: normalRows.length, filtered: normalRows.length, parsedFiltered: 0 };
        }

        const parsedRows = normalRows.map((row) => getParsedRow(row));
        return getFilteredCount(parsedRows, filters);
    }, [filters, getParsedRow, isLargeFile, lineCount, normalRows]);

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
        if (!isMonitoring || !isLargeFile) return;

        const cached = largeFileViewCache.get(largeFileCacheKey);
        if (cached) {
            lineOffsetsRef.current = cached.lineOffsets;
            setLineCount(cached.lineCount);
            setLargeFileHistogramLines(cached.histogramLines);
            setIsHistogramLoading(false);
            setHistogramProgress(0);

            lineCacheRef.current = new Map();
            cacheBytesRef.current = 0;
            setLineCacheVersion((version) => version + 1);

            if (cached.lineCount > 0) {
                if (viewMode === 'live-tail') {
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
            const existingCache = largeFileViewCache.get(largeFileCacheKey);
            setLargeFileViewCache(largeFileCacheKey, {
                lineOffsets: offsets,
                lineCount: offsets.length,
                histogramLines: existingCache?.histogramLines ?? [],
            });

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
    }, [isMonitoring, isLargeFile, largeFileCacheKey, buildLineIndex, getActiveFile, requestRangeLoad, viewMode]);

    useEffect(() => {
        if (!isLargeFile || lineCount === 0) return;

        if (viewMode === 'live-tail') {
            const start = Math.max(0, lineCount - 1 - RANGE_LOAD_PADDING);
            requestRangeLoad(start, lineCount - 1);
        } else {
            requestRangeLoad(0, Math.min(RANGE_LOAD_PADDING, lineCount - 1));
        }
    }, [viewMode, isLargeFile, lineCount, requestRangeLoad]);

    useEffect(() => {
        if (!isLargeFile || !isMonitoring || lineCount === 0) {
            setIsHistogramLoading(false);
            setHistogramProgress(0);
            setLargeFileHistogramLines([]);
            return;
        }

        const cached = largeFileViewCache.get(largeFileCacheKey);
        if (cached && cached.histogramLines.length > 0) {
            setLargeFileHistogramLines(cached.histogramLines);
            setIsHistogramLoading(false);
            setHistogramProgress(0);
            return;
        }

        let cancelled = false;

        const scanFileForHistogram = async () => {
            const file = await getActiveFile();
            if (!file || cancelled) return;

            setIsHistogramLoading(true);
            setHistogramProgress(0);

            const { sampledLines } = await sampleAndAnalyzeLargeFile(file, lineCount, {
                onProgress: (progress) => setHistogramProgress(progress),
                isCancelled: () => cancelled,
            });

            if (cancelled) {
                return;
            }

            setLargeFileHistogramLines(sampledLines);
            const existingCache = largeFileViewCache.get(largeFileCacheKey);
            setLargeFileViewCache(largeFileCacheKey, {
                lineOffsets: existingCache?.lineOffsets ?? lineOffsetsRef.current,
                lineCount: existingCache?.lineCount ?? lineCount,
                histogramLines: sampledLines,
            });
            setIsHistogramLoading(false);
        };

        void scanFileForHistogram();

        return () => {
            cancelled = true;
        };
    }, [getActiveFile, isLargeFile, isMonitoring, lineCount, largeFileCacheKey]);

    useEffect(() => {
        if (!isLargeFile) {
            setVirtualWindowStart(0);
            return;
        }

        setVirtualWindowStart((current) => clampWindowStart(current, lineCount));
    }, [clampWindowStart, isLargeFile, lineCount]);

    useEffect(() => {
        if (!isLargeFile) return;
        if (rebaseAnchorRef.current === null) return;
        if (!virtuosoRef.current) return;

        const virtualCount = getVirtualWindowSize(virtualWindowStart, lineCount);
        if (virtualCount <= 0) return;

        const anchor = Math.max(0, Math.min(rebaseAnchorRef.current, virtualCount - 1));
        virtuosoRef.current.scrollToIndex({ index: anchor, align: 'center', behavior: 'auto' });
        rebaseAnchorRef.current = null;
    }, [getVirtualWindowSize, isLargeFile, lineCount, virtualWindowStart]);

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
                parsedLinesCount={isLargeFile ? lineCount : normalRows.length}
                filterStats={filterStats}
                contentSize={content?.length || 0}
                fileSize={fileSize}
                newLinesCount={newLinesCount}
                isAnomalyLoading={anomalyIsRunning}
                canRunAnomalyAnalysis={canRunAnomalyAnalysis}
                anomalyDisabledReason={anomalyDisabledReason}
                selectedModelId={selectedModelId}
                anomalySettings={anomalySettings}
                thresholdRange={ANOMALY_THRESHOLD_RANGE}
                stepSizeRange={ANOMALY_STEP_SIZE_RANGE}
                minRegionLinesRange={ANOMALY_MIN_REGION_LINES_RANGE}
                isAnomalySettingsPanelOpen={isAnomalySettingsPanelOpen}
                onToggleAnomalySettingsPanel={() => setIsAnomalySettingsPanelOpen((prev) => !prev)}
                onAnomalySettingsChange={updateAnomalySettings}
                onSensitivityProfileApply={applySensitivityProfile}
                onResetAnomalySettings={resetAnomalySettings}
                onSelectedModelChange={handleSelectedModelChange}
                onRunAnomalyAnalysis={runAnomalyAnalysis}
            />

            {/* Log Timeline Histogram */}
            {isLargeFile && isHistogramLoading && (
                <Box
                    sx={{
                        height: 150,
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        backgroundColor: (theme) => theme.palette.background.paper,
                    }}
                >
                    <CircularProgress size={24} />
                    <Typography variant="body2" color="text.secondary">
                        Building full-file histogram in background... {histogramProgress}%
                    </Typography>
                </Box>
            )}
            {(!isLargeFile || !isHistogramLoading) && histogramSourceLines.length > 0 && (
                <LogHistogram
                    parsedLines={histogramSourceLines}
                    defaultCollapsed={false}
                    height={150}
                    anomalyRegions={anomalyRegions}
                    anomalyLineNumbers={anomalyLineNumbers}
                    onAnomalyRangeSelect={handleAnomalyRangeSelect}
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
                    totalCount={isLargeFile ? getVirtualWindowSize(virtualWindowStart, lineCount) : displayLines.length}
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