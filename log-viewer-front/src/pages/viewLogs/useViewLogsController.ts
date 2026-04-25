import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { VirtuosoHandle } from 'react-virtuoso';
import { RootState } from '../../redux/store';
import { ViewModeEnum } from '../../constants/ViewModeEnum';
import {
    clearLogContent,
    clearFormatChangeRequest,
    getFileHandle,
    getFileObject,
    setIndexingState,
    setLogFile,
    updateLogContent,
} from '../../redux/slices/logFileSlice';
import { setAnomalyResults } from '../../redux/slices/anomalySlice';
import { enqueueNotification } from '../../redux/slices/notificationsSlice';
import {
    buildCustomFormatPattern,
    detectLogFormat,
    getFormatFields,
    getLogFormatById,
    parseLogLineAuto,
    registerCustomLogFormat,
    type LogFormatField,
    type ParsedLogLine,
} from '../../utils/logFormatDetector';
import type { LogFilters } from '../../types/filters';
import { applyLogFilters } from '../../utils/logFilters';
import { useFileLoader } from '../../hooks/useFileLoader';
import { useParsedRowsCache } from '../../hooks/useParsedRowsCache';
import {
    findAdjacentLineMatch,
    getDashboardSnapshot,
    getSession,
    getLinesRange,
    getSessionLineCount,
    queryFilteredLines,
    upsertCustomLogFormat,
    upsertSession,
} from '../../utils/logIndexedDb';
import { appendLogFileToIndex } from '../../utils/logIndexer';
import {
    beginRemoteUploadSession,
    deleteRemoteIngest,
    endRemoteUploadSession,
    finishRemoteIngest,
    getRemoteIngestStatus,
    setActiveRemoteUploadIngestId,
    startRemoteIngest,
    uploadRemoteIngestChunk,
} from '../../services/bglAnomalyApi';
import { useAnomalySnapshot } from './hooks/useAnomalySnapshot';
import { useTranslation } from 'react-i18next';

const LINE_INDEX_CHUNK_BYTES = 4 * 1024 * 1024;
const LINE_INDEX_CHUNK_SIZE = 1_000_000;
const RANGE_LOAD_PADDING = 60;
const MAX_CACHE_LINES = 500;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_RANGE_BYTES = 512 * 1024;
const MAX_VIRTUAL_ROWS = 1_500_000;
const WINDOW_REBASE_MARGIN = 200_000;
const MAX_LARGE_FILE_VIEW_CACHE_ENTRIES = 3;
const REMOTE_FILTER_PAGE_ROWS = 20_000;
const MAX_FILTER_ROWS_IN_MEMORY = 50_000;
const REMOTE_FILTER_LOAD_EDGE_ROWS = 2_000;
const PREVIEW_BYTES = 2 * 1024 * 1024;
const DB_RANGE_LOAD_PADDING = 120;
const REMOTE_INGEST_CHUNK_BYTES = 4 * 1024 * 1024;
const REMOTE_LINE_COUNT_RETRY_ATTEMPTS = 20;
const REMOTE_LINE_COUNT_RETRY_DELAY_MS = 500;
const REMOTE_CONNECTION_RETRY_MS = 5000;
const LINE_INDEX_PROGRESS_REPORT_MS = 120;
const LINE_INDEX_PROGRESS_MIN_NEW_LINES = 2_000;
const TAIL_LOAD_BYTES = 768 * 1024;
const TAIL_LOAD_MAX_LINES = 400;
const SEARCH_SCAN_CHUNK_LINES = 256;
const ANOMALY_FILTER_KEY = 'anomalyStatus';
const TIMELINE_FILTER_DEBOUNCE_MS = 300;
const TIMELINE_FILTER_FALLBACK_FIELD = 'timestamp';

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

type DisplayLineItem = {
    raw: string;
    displayLineNumber: number;
    sourceLineNumber: number;
    anomalyStatus?: 'anomaly' | 'normal';
    parsedMeta?: {
        formatId: string;
        fields: Record<string, string>;
        fieldOrder: string[];
    };
    parseState?: 'parsed' | 'unparsed' | 'loading';
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

type AnomalyFilterSelection = {
    includeAnomaly: boolean;
    includeNormal: boolean;
    includeUndefined: boolean;
};

type AnomalyLineInterval = {
    start: number;
    end: number;
};

type RemoteFilterPaginationState = {
    active: boolean;
    loadFromEnd: boolean;
    oldestLineNumber?: number;
    newestLineNumber?: number;
    hasMoreOlder: boolean;
    hasMoreNewer: boolean;
    isLoading: boolean;
};

type RemoteFilterMergeResult = {
    rows: ViewRow[];
    prependedCount: number;
    droppedFromStart: number;
    droppedFromEnd: number;
};

type BuildLineIndexOptions = {
    onProgress?: (offsets: LineIndex, lineCount: number) => void;
    isCancelled?: () => boolean;
};

type UnknownFormatDialogState = {
    open: boolean;
    previewLines: string[];
    fileName: string;
};

type UnknownFormatConfirmDialogState = {
    open: boolean;
    fileName: string;
    fileSize: number;
    previewText: string;
    previewLines: string[];
};

type FormatChangeDialogState = {
    open: boolean;
    message: string;
    nextFormatId: string;
};

type MonitoringReplaceConfirmDialogState = {
    open: boolean;
    message: string;
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

const countPhysicalLines = (logContent: string): number => {
    if (!logContent) {
        return 0;
    }

    const lines = logContent.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        return lines.length - 1;
    }
    return lines.length;
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

const splitAnomalyFilter = (filters: LogFilters): {
    dataFilters: LogFilters;
    anomalySelection: AnomalyFilterSelection;
} => {
    const anomalyRaw = filters[ANOMALY_FILTER_KEY];
    const values = Array.isArray(anomalyRaw)
        ? anomalyRaw.map((item) => String(item).toLowerCase())
        : [];

    const includeAnomaly = values.includes('anomaly');
    const includeNormal = values.includes('normal');
    const includeUndefined = values.includes('undefined');

    const dataFilters: LogFilters = { ...filters };
    delete dataFilters[ANOMALY_FILTER_KEY];

    return {
        dataFilters,
        anomalySelection: {
            includeAnomaly,
            includeNormal,
            includeUndefined,
        },
    };
};

export const useViewLogsController = () => {
    const [selectedLine, setSelectedLine] = useState<number | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [viewMode, setViewMode] = useState<ViewModeEnum>(ViewModeEnum.FromEnd);
    const viewModeRef = useRef<ViewModeEnum>(ViewModeEnum.FromEnd);

    const dispatch = useDispatch();
    const { t } = useTranslation();

    const {
        content,
        name: fileName,
        format,
        requestedFormatId,
        isMonitoring,
        hasFileHandle,
        size: fileSize,
        lastModified,
        isLargeFile,
        analyticsSessionId,
        loaded,
        isIndexing,
        indexingProgress,
    } = useSelector((state: RootState) => state.logFile);

    const {
        regions: anomalyRegions,
        lineNumbers: anomalyLineNumbers,
        hasResults: hasAnomalyResults,
        isRunning: anomalyIsRunning,
        rowsCount: anomalyRowsCount,
        totalRows: anomalyTotalRows,
        lastAnalyzedAt: anomalyLastAnalyzedAt,
        lastModelId: anomalyLastModelId,
        lastRunParams: anomalyLastRunParams,
    } = useSelector((state: RootState) => state.anomaly);

    const [normalRows, setNormalRows] = useState<ViewRow[]>([]);
    const [indexedFilteredRows, setIndexedFilteredRows] = useState<ViewRow[]>([]);
    const [isFilteringRows, setIsFilteringRows] = useState<boolean>(false);
    const [indexedHistogramLines, setIndexedHistogramLines] = useState<ViewParsedLine[]>([]);
    const [isHistogramLoading, setIsHistogramLoading] = useState<boolean>(false);
    const [filters, setFilters] = useState<LogFilters>({});
    const [searchTerm, setSearchTerm] = useState<string>('');
    const timelineFilterFieldRef = useRef<string>(TIMELINE_FILTER_FALLBACK_FIELD);
    const timelineFilterTimerRef = useRef<number | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const lastModifiedRef = useRef<number>(0);
    const lastSizeRef = useRef<number>(0);
    const lineOffsetsRef = useRef<LineIndex>(createLineIndex());
    const lineCacheRef = useRef<Map<number, { text: string; size: number }>>(new Map());
    const cacheBytesRef = useRef<number>(0);
    const [lineCount, setLineCount] = useState<number>(0);
    const [lineCacheVersion, setLineCacheVersion] = useState<number>(0);
    const [tailLoadedRows, setTailLoadedRows] = useState<DisplayLineItem[]>([]);
    const dbLineCacheRef = useRef<Map<number, DbLineCacheEntry>>(new Map());
    const dbCacheBytesRef = useRef<number>(0);
    const [dbLineCount, setDbLineCount] = useState<number>(0);
    const [dbLineCacheVersion, setDbLineCacheVersion] = useState<number>(0);
    const remoteExpectedLineCountRef = useRef<number>(0);
    const [isRemoteServerDisconnected, setIsRemoteServerDisconnected] = useState(false);
    const [serverUploadInProgress, setServerUploadInProgress] = useState(false);
    const [serverUploadProgress, setServerUploadProgress] = useState(0);
    const [customFormatDialogState, setCustomFormatDialogState] = useState<UnknownFormatDialogState>({
        open: false,
        previewLines: [],
        fileName: '',
    });
    const [confirmDialogState, setConfirmDialogState] = useState<UnknownFormatConfirmDialogState>({
        open: false,
        fileName: '',
        fileSize: 0,
        previewText: '',
        previewLines: [],
    });
    const [formatChangeDialogState, setFormatChangeDialogState] = useState<FormatChangeDialogState>({
        open: false,
        message: '',
        nextFormatId: 'unknown',
    });
    const [monitoringReplaceDialogState, setMonitoringReplaceDialogState] = useState<MonitoringReplaceConfirmDialogState>({
        open: false,
        message: '',
    });
    const pendingUnknownFormatResolverRef = useRef<((resolution: { mode: 'continue-unknown' | 'use-format'; formatId?: string }) => void) | null>(null);
    const pendingFormatChangeResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
    const pendingMonitoringReplaceResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
    const [virtualWindowStart, setVirtualWindowStart] = useState<number>(0);
    const [dbVirtualWindowStart, setDbVirtualWindowStart] = useState<number>(0);
    const { getParsedRow, clearParsedRowCache } = useParsedRowsCache();
    const buildLineParsePreview = useCallback((lineNumber: number, raw: string) => {
        const parsedLine = getParsedRow({ lineNumber, raw });
        if (!parsedLine.parsed) {
            return { parseState: 'unparsed' as const };
        }

        return {
            parseState: 'parsed' as const,
            parsedMeta: {
                formatId: parsedLine.parsed.formatId,
                fields: parsedLine.parsed.fields,
                fieldOrder: Object.keys(parsedLine.parsed.fields),
            },
        };
    }, [getParsedRow]);
    const rebaseAnchorRef = useRef<number | null>(null);
    const dbRebaseAnchorRef = useRef<number | null>(null);
    const rangeLoadStateRef = useRef<{ pending: { start: number; end: number } | null; isLoading: boolean }>({
        pending: null,
        isLoading: false,
    });
    const dbRangeLoadStateRef = useRef<{ pending: { start: number; end: number } | null; isLoading: boolean }>({
        pending: null,
        isLoading: false,
    });
    const remoteFilteredRangeRef = useRef<{ start: number; end: number; previousStart: number }>({
        start: 0,
        end: 0,
        previousStart: 0,
    });
    const remoteFilterPaginationRef = useRef<RemoteFilterPaginationState>({
        active: false,
        loadFromEnd: false,
        hasMoreOlder: false,
        hasMoreNewer: false,
        isLoading: false,
    });
    const resolveUnknownFormat = useCallback(async (context: {
        fileName: string;
        fileSize: number;
        previewText: string;
        previewLines: string[];
    }) => {
        return await new Promise<{ mode: 'continue-unknown' | 'use-format'; formatId?: string }>((resolve) => {
            pendingUnknownFormatResolverRef.current = resolve;
            setConfirmDialogState({
                open: true,
                fileName: context.fileName,
                fileSize: context.fileSize,
                previewText: context.previewText,
                previewLines: context.previewLines,
            });
        });
    }, []);

    const confirmMonitoringFileReplace = useCallback(async (context: {
        expectedName?: string;
        selectedName: string;
        expectedSize?: number;
        selectedSize: number;
    }) => {
        const baseMessage = context.expectedName
            ? t('viewLogs.monitoringReplace.withNames', {
                selectedName: context.selectedName,
                expectedName: context.expectedName,
            })
            : t('viewLogs.monitoringReplace.withoutNames');

        return await new Promise<boolean>((resolve) => {
            pendingMonitoringReplaceResolverRef.current = resolve;
            setMonitoringReplaceDialogState({
                open: true,
                message: baseMessage,
            });
        });
    }, [t]);

    const {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
        handleFileSystemAccessForMonitoring,
        reloadCurrentFileWithFormat,
    } = useFileLoader({
        resolveUnknownFormat,
        confirmMonitoringFileReplace,
        onFileLoadStart: () => {
            setFilters({});
            setSearchTerm('');
        },
    });

    const largeFileCacheKey = analyticsSessionId || `${fileName}|${fileSize}`;

    const activeFileIdentity = useMemo(() => {
        if (!loaded || !fileName) {
            return '';
        }

        if (analyticsSessionId) {
            return `session:${analyticsSessionId}`;
        }

        return `file:${fileName}|${fileSize}|${lastModified}`;
    }, [analyticsSessionId, fileName, fileSize, lastModified, loaded]);
    const previousActiveFileIdentityRef = useRef<string>('');

    useEffect(() => {
        if (!activeFileIdentity) {
            previousActiveFileIdentityRef.current = '';
            return;
        }

        const previousIdentity = previousActiveFileIdentityRef.current;
        previousActiveFileIdentityRef.current = activeFileIdentity;

        if (!previousIdentity || previousIdentity === activeFileIdentity) {
            return;
        }

        setFilters({});
        setSearchTerm('');
        setSelectedLine(null);
    }, [activeFileIdentity]);

    useEffect(() => {
        return () => {
            lineOffsetsRef.current = createLineIndex();
            lineCacheRef.current = new Map();
            cacheBytesRef.current = 0;

            dbLineCacheRef.current = new Map();
            dbCacheBytesRef.current = 0;

            rangeLoadStateRef.current = {
                pending: null,
                isLoading: false,
            };
            dbRangeLoadStateRef.current = {
                pending: null,
                isLoading: false,
            };

            remoteFilterPaginationRef.current = {
                active: false,
                loadFromEnd: false,
                hasMoreOlder: false,
                hasMoreNewer: false,
                isLoading: false,
            };
            remoteFilteredRangeRef.current = {
                start: 0,
                end: 0,
                previousStart: 0,
            };

            clearParsedRowCache();
            largeFileViewCache.clear();

            if (pendingUnknownFormatResolverRef.current) {
                pendingUnknownFormatResolverRef.current({ mode: 'continue-unknown' });
                pendingUnknownFormatResolverRef.current = null;
            }

            if (pendingMonitoringReplaceResolverRef.current) {
                pendingMonitoringReplaceResolverRef.current(false);
                pendingMonitoringReplaceResolverRef.current = null;
            }
        };
    }, [clearParsedRowCache]);

    const closeUnknownFormatDialog = useCallback(() => {
        setCustomFormatDialogState({ open: false, previewLines: [], fileName: '' });

        if (pendingUnknownFormatResolverRef.current) {
            pendingUnknownFormatResolverRef.current({ mode: 'continue-unknown' });
            pendingUnknownFormatResolverRef.current = null;
        }
    }, []);

    const handleFormatChangeDialogConfirm = useCallback(() => {
        setFormatChangeDialogState({ open: false, message: '', nextFormatId: 'unknown' });
        pendingFormatChangeResolverRef.current?.(true);
        pendingFormatChangeResolverRef.current = null;
    }, []);

    const handleFormatChangeDialogCancel = useCallback(() => {
        setFormatChangeDialogState({ open: false, message: '', nextFormatId: 'unknown' });
        pendingFormatChangeResolverRef.current?.(false);
        pendingFormatChangeResolverRef.current = null;
    }, []);

    const handleMonitoringReplaceConfirm = useCallback(() => {
        setMonitoringReplaceDialogState({ open: false, message: '' });
        pendingMonitoringReplaceResolverRef.current?.(true);
        pendingMonitoringReplaceResolverRef.current = null;
    }, []);

    const handleMonitoringReplaceCancel = useCallback(() => {
        setMonitoringReplaceDialogState({ open: false, message: '' });
        pendingMonitoringReplaceResolverRef.current?.(false);
        pendingMonitoringReplaceResolverRef.current = null;
    }, []);

    const handleConfirmDialogConfirm = useCallback(() => {
        setConfirmDialogState({
            open: false,
            fileName: '',
            fileSize: 0,
            previewText: '',
            previewLines: [],
        });
        setCustomFormatDialogState({
            open: true,
            previewLines: confirmDialogState.previewLines,
            fileName: confirmDialogState.fileName,
        });
    }, [confirmDialogState.fileName, confirmDialogState.previewLines]);

    const handleConfirmDialogCancel = useCallback(() => {
        setConfirmDialogState({
            open: false,
            fileName: '',
            fileSize: 0,
            previewText: '',
            previewLines: [],
        });

        if (pendingUnknownFormatResolverRef.current) {
            pendingUnknownFormatResolverRef.current({ mode: 'continue-unknown' });
            pendingUnknownFormatResolverRef.current = null;
        }
    }, []);

    const handleCreateCustomFormatForUnknown = useCallback(async (payload: {
        name: string;
        description: string;
        regex: string;
    }) => {
        const saved = await upsertCustomLogFormat({
            id: `user-${Date.now()}`,
            name: payload.name,
            description: payload.description,
            regex: payload.regex,
        });

        const runtimeFormat = buildCustomFormatPattern(saved);
        if (!runtimeFormat) {
            throw new Error(t('viewLogs.customFormatDialog.registerError'));
        }

        registerCustomLogFormat(runtimeFormat);

        const resolver = pendingUnknownFormatResolverRef.current;
        pendingUnknownFormatResolverRef.current = null;
        setCustomFormatDialogState({ open: false, previewLines: [], fileName: '' });

        resolver?.({ mode: 'use-format', formatId: saved.id });
    }, [t]);

    const anomalyStorageKey = useMemo(() => {
        if (analyticsSessionId) {
            return analyticsSessionId;
        }

        if (!loaded || !fileName) {
            return '';
        }

        return `file:${fileName}|${fileSize}|${lastModified}`;
    }, [analyticsSessionId, fileName, fileSize, lastModified, loaded]);

    useAnomalySnapshot({
        storageKey: anomalyStorageKey,
        isRunning: anomalyIsRunning,
        hasResults: hasAnomalyResults,
        lastAnalyzedAt: anomalyLastAnalyzedAt,
        lastModelId: anomalyLastModelId,
        lastRunParams: anomalyLastRunParams,
        regions: anomalyRegions,
        rowsCount: anomalyRowsCount,
        totalRows: anomalyTotalRows,
    });

    const isRemoteLargeSession = isLargeFile && analyticsSessionId.startsWith('remote:');
    const isStreamView = !isRemoteLargeSession && (isLargeFile || isIndexing);
    const requiresServerUpload = isLargeFile && !isRemoteLargeSession;
    const isServerUploadActive = requiresServerUpload && isIndexing;
    const normalizedFormatId = (format || '').trim() || 'unknown';
    const uploadDisabledReason = '';
    const isDbView = !isStreamView && Boolean(analyticsSessionId);
    const smallFileTotalRows = useMemo(() => countPhysicalLines(content ?? ''), [content]);
    const totalRowsHintForAnomaly = useMemo(() => {
        if (isStreamView) {
            return Math.max(0, lineCount, tailLoadedRows.length);
        }
        if (isDbView) {
            return Math.max(0, dbLineCount);
        }
        return Math.max(0, smallFileTotalRows);
    }, [dbLineCount, isDbView, isStreamView, lineCount, smallFileTotalRows, tailLoadedRows.length]);

    useEffect(() => {
        if (!hasAnomalyResults) {
            return;
        }
        if (!anomalyLastAnalyzedAt || !anomalyLastModelId || !anomalyLastRunParams) {
            return;
        }
        if (anomalyLastRunParams.analysisScope !== 'all') {
            return;
        }
        // Legacy snapshots/results could store denominator equal to anomaly rows (shows 100%).
        if (anomalyTotalRows !== anomalyRowsCount) {
            return;
        }
        if (totalRowsHintForAnomaly <= anomalyRowsCount) {
            return;
        }

        dispatch(setAnomalyResults({
            regions: anomalyRegions,
            lineNumbers: anomalyLineNumbers,
            rowsCount: anomalyRowsCount,
            totalRows: totalRowsHintForAnomaly,
            analyzedAt: anomalyLastAnalyzedAt,
            modelId: anomalyLastModelId,
            params: anomalyLastRunParams,
        }));
    }, [
        anomalyLastAnalyzedAt,
        anomalyLastModelId,
        anomalyLastRunParams,
        anomalyLineNumbers,
        anomalyRegions,
        anomalyRowsCount,
        anomalyTotalRows,
        dispatch,
        hasAnomalyResults,
        totalRowsHintForAnomaly,
    ]);

    const getActiveFile = useCallback(async (): Promise<File | null> => {
        if (hasFileHandle) {
            const handle = getFileHandle();
            if (handle) {
                return await handle.getFile();
            }
        }

        return getFileObject();
    }, [hasFileHandle]);

    const loadTailRows = useCallback(async (file: File): Promise<DisplayLineItem[]> => {
        const tailStart = Math.max(0, file.size - TAIL_LOAD_BYTES);
        const tailText = await file.slice(tailStart, file.size).text();
        let lines = tailText.split(/\r?\n/);

        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines = lines.slice(0, -1);
        }

        if (tailStart > 0 && lines.length > 0) {
            // When we start from middle of file, first split entry can be a partial line.
            lines = lines.slice(1);
        }

        const limited = lines.slice(-TAIL_LOAD_MAX_LINES);
        if (limited.length === 0) {
            return [];
        }

        const total = limited.length;
        return limited.slice().reverse().map((raw, index) => {
            const rowNumber = total - index;
            return {
                raw,
                displayLineNumber: rowNumber,
                sourceLineNumber: rowNumber,
                ...buildLineParsePreview(rowNumber, raw),
            };
        });
    }, [buildLineParsePreview]);

    useEffect(() => {
        if (loaded || fileName) {
            return;
        }

        lineOffsetsRef.current = createLineIndex();
        lineCacheRef.current = new Map();
        cacheBytesRef.current = 0;
        setLineCacheVersion((version) => version + 1);
        setLineCount(0);
        setTailLoadedRows([]);

        dbLineCacheRef.current = new Map();
        dbCacheBytesRef.current = 0;
        setDbLineCacheVersion((version) => version + 1);
        setDbLineCount(0);

        setVirtualWindowStart(0);
        setDbVirtualWindowStart(0);
        setSelectedLine(null);
        setNormalRows([]);
        setIndexedFilteredRows([]);
        setIndexedHistogramLines([]);
        remoteExpectedLineCountRef.current = 0;

        largeFileViewCache.clear();
    }, [fileName, loaded]);

    const refreshLastDbLineCache = useCallback(async (lineCount: number) => {
        if (!analyticsSessionId || lineCount <= 0) {
            return;
        }

        const cacheIndex = lineCount - 1;
        const cache = dbLineCacheRef.current;
        const existing = cache.get(cacheIndex);
        if (existing) {
            cache.delete(cacheIndex);
            dbCacheBytesRef.current -= existing.size;
        }

        try {
            const [lastRecord] = await getLinesRange(analyticsSessionId, lineCount, lineCount);
            if (lastRecord) {
                const size = lastRecord.raw.length * 2;
                cache.set(cacheIndex, { text: lastRecord.raw, size });
                dbCacheBytesRef.current += size;

                while (cache.size > MAX_CACHE_LINES || dbCacheBytesRef.current > MAX_CACHE_BYTES) {
                    const oldestKey = cache.keys().next().value as number | undefined;
                    if (oldestKey === undefined) break;
                    const removed = cache.get(oldestKey);
                    cache.delete(oldestKey);
                    if (removed) {
                        dbCacheBytesRef.current -= removed.size;
                    }
                }
            }
        } catch (error) {
            console.error('Failed to refresh last DB line cache:', error);
        } finally {
            setDbLineCacheVersion((version) => version + 1);
        }
    }, [analyticsSessionId]);

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

        if (!isDbView) return;

        const previousDbLineCount = dbLineCount;
        const appendResult = await appendLogFileToIndex(file, analyticsSessionId);
        if (!appendResult) return;

        setDbLineCount(appendResult.newLineCount);
        if (appendResult.addedLines <= 0 && (appendResult.newLineCount > 0 || previousDbLineCount > 0)) {
            const lastLineCount = appendResult.newLineCount > 0 ? appendResult.newLineCount : previousDbLineCount;
            void refreshLastDbLineCache(lastLineCount);
        }
    }, [
        analyticsSessionId,
        dbLineCount,
        fileName,
        fileSize,
        format,
        getActiveFile,
        handleFileSystemAccessForMonitoring,
        isDbView,
        isLargeFile,
        refreshLastDbLineCache,
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

    const handleFormatChange = useCallback(async (nextFormatIdRaw: string) => {
        const nextFormatId = (nextFormatIdRaw || '').trim() || 'unknown';
        if (!loaded || nextFormatId === normalizedFormatId) {
            return;
        }

        if (nextFormatId !== 'unknown' && !getLogFormatById(nextFormatId)) {
            dispatch(enqueueNotification({
                message: t('viewLogs.formatChange.formatNotFound'),
                severity: 'error',
            }));
            return;
        }

        let confirmationMessage = t('viewLogs.formatChange.confirmDefault');

        if (isRemoteLargeSession && analyticsSessionId.startsWith('remote:')) {
            confirmationMessage = t('viewLogs.formatChange.confirmRemote');
        } else if (analyticsSessionId) {
            const session = await getSession(analyticsSessionId);
            const hasIndexedData = Boolean(session && (session.lineCount > 0 || isIndexing));
            confirmationMessage = hasIndexedData
                ? t('viewLogs.formatChange.confirmIndexedDb')
                : t('viewLogs.formatChange.confirmDefault');
        }

        const confirmed = await new Promise<boolean>((resolve) => {
            pendingFormatChangeResolverRef.current = resolve;
            setFormatChangeDialogState({
                open: true,
                message: confirmationMessage,
                nextFormatId,
            });
        });

        if (!confirmed) {
            return;
        }

        try {
            if (isRemoteLargeSession && analyticsSessionId.startsWith('remote:')) {
                const ingestId = analyticsSessionId.slice('remote:'.length);
                if (ingestId) {
                    await deleteRemoteIngest(ingestId);
                }
            }

            const reloaded = await reloadCurrentFileWithFormat(nextFormatId);
            if (!reloaded) {
                dispatch(enqueueNotification({
                    message: t('viewLogs.formatChange.reloadFailed'),
                    severity: 'error',
                }));
                return;
            }

            if (isRemoteLargeSession) {
                dispatch(enqueueNotification({
                    message: t('viewLogs.formatChange.changedUploadAgain'),
                    severity: 'warning',
                }));
            }
        } catch (error) {
            console.error('Failed to change log format:', error);
            dispatch(enqueueNotification({
                message: t('viewLogs.formatChange.failed'),
                severity: 'error',
            }));
        }
    }, [
        analyticsSessionId,
        dispatch,
        isIndexing,
        isRemoteLargeSession,
        loaded,
        normalizedFormatId,
        reloadCurrentFileWithFormat,
        t,
    ]);

    useEffect(() => {
        if (!requestedFormatId) {
            return;
        }

        dispatch(clearFormatChangeRequest());
        void handleFormatChange(requestedFormatId);
    }, [dispatch, handleFormatChange, requestedFormatId]);

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
        remoteExpectedLineCountRef.current = 0;
        dispatch(setIndexingState({ isIndexing: true, progress: 0 }));

        const uploadController = beginRemoteUploadSession();
        const uploadSignal = uploadController.signal;
        let startedIngestId: string | null = null;

        try {
            const selectedFormat = getLogFormatById(format);
            const parserPattern = selectedFormat?.patterns?.[0]?.source;
            const started = await startRemoteIngest(file.name, file.size, {
                formatId: format && format !== 'unknown' ? format : undefined,
                parserPattern,
            });
            startedIngestId = started.ingest_id;
            setActiveRemoteUploadIngestId(startedIngestId);

            if (uploadSignal.aborted) {
                await deleteRemoteIngest(startedIngestId);
                return;
            }

            let offset = 0;
            while (offset < file.size) {
                if (uploadSignal.aborted) {
                    await deleteRemoteIngest(started.ingest_id);
                    return;
                }

                const nextEnd = Math.min(file.size, offset + REMOTE_INGEST_CHUNK_BYTES);
                const chunk = await file.slice(offset, nextEnd).arrayBuffer();
                await uploadRemoteIngestChunk(started.ingest_id, chunk, { signal: uploadSignal });
                offset = nextEnd;

                const percent = file.size > 0
                    ? Math.min(99, Math.max(0, Math.round((offset / file.size) * 100)))
                    : 0;
                setServerUploadProgress(percent);
                dispatch(setIndexingState({ isIndexing: true, progress: percent }));
            }

            if (uploadSignal.aborted) {
                await deleteRemoteIngest(started.ingest_id);
                return;
            }

            const finishedIngest = await finishRemoteIngest(started.ingest_id);
            setServerUploadProgress(100);
            const finishedLineCount = Math.max(0, Number(finishedIngest.total_lines ?? 0));
            remoteExpectedLineCountRef.current = finishedLineCount;

            if (uploadSignal.aborted) {
                await deleteRemoteIngest(started.ingest_id);
                remoteExpectedLineCountRef.current = 0;
                return;
            }

            const remoteSessionId = `remote:${started.ingest_id}`;
            await upsertSession({
                sessionId: remoteSessionId,
                fileName,
                fileSize,
                lastModified,
                formatId: format || 'unknown',
                createdAt: Date.now(),
                lastOpenedAt: Date.now(),
                isIndexed: true,
                lineCount: finishedLineCount,
                previewText: content.slice(0, PREVIEW_BYTES),
            });

            if (uploadSignal.aborted) {
                await deleteRemoteIngest(started.ingest_id);
                remoteExpectedLineCountRef.current = 0;
                return;
            }

            dispatch(setLogFile({
                name: fileName,
                size: fileSize,
                format,
                content,
                lastModified,
                hasFileHandle,
                isLargeFile,
                analyticsSessionId: remoteSessionId,
            }));

            dispatch(enqueueNotification({
                message: finishedLineCount > 0
                    ? t('viewLogs.serverUpload.successWithLines', { count: finishedLineCount as number })
                    : t('viewLogs.serverUpload.success'),
                severity: 'success',
            }));
        } catch (error) {
            remoteExpectedLineCountRef.current = 0;
            if ((error as Error).name !== 'AbortError') {
                console.error('Failed to upload large file to server:', error);
                const message = error instanceof Error && error.message
                    ? error.message
                    : t('viewLogs.serverUpload.failed');
                dispatch(enqueueNotification({
                    message,
                    severity: 'error',
                }));
            }

            if (startedIngestId) {
                try {
                    await deleteRemoteIngest(startedIngestId);
                } catch (cleanupError) {
                    console.error('Failed to cleanup remote ingest after upload interruption:', cleanupError);
                }
            }
        } finally {
            dispatch(setIndexingState({ isIndexing: false, progress: 0 }));
            setServerUploadInProgress(false);
            endRemoteUploadSession(uploadController);
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

    const buildLineIndex = useCallback(async (
        file: File,
        options: BuildLineIndexOptions = {},
    ): Promise<LineIndex> => {
        const offsets = createLineIndex();
        if (file.size === 0) {
            options.onProgress?.(offsets, 0);
            return offsets;
        }

        pushOffset(offsets, 0);

        let lastReportedCount = 0;
        let lastReportedAt = 0;
        const reportProgress = (force = false): boolean => {
            if (!options.onProgress) {
                return false;
            }

            const nextCount = offsets.length;
            if (!force) {
                if (nextCount === lastReportedCount) {
                    return false;
                }

                const now = performance.now();
                const linesDelta = nextCount - lastReportedCount;
                const timeDelta = now - lastReportedAt;
                if (
                    linesDelta < LINE_INDEX_PROGRESS_MIN_NEW_LINES
                    && timeDelta < LINE_INDEX_PROGRESS_REPORT_MS
                ) {
                    return false;
                }

                lastReportedAt = now;
            } else {
                lastReportedAt = performance.now();
            }

            lastReportedCount = nextCount;
            options.onProgress(offsets, nextCount);
            return true;
        };

        reportProgress(true);

        let offset = 0;
        while (offset < file.size) {
            if (options.isCancelled?.()) {
                return offsets;
            }

            const buffer = await file.slice(offset, offset + LINE_INDEX_CHUNK_BYTES).arrayBuffer();
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.length; i += 1) {
                if (bytes[i] === 10) {
                    pushOffset(offsets, offset + i + 1);
                }
            }
            offset += bytes.length;

            const hasReported = reportProgress();
            if (hasReported) {
                await new Promise<void>((resolve) => {
                    window.setTimeout(() => resolve(), 0);
                });
            }
        }

        if (offsets.length > 0) {
            const lastOffset = getOffsetAt(offsets, offsets.length - 1);
            if (lastOffset === file.size) {
                popOffset(offsets);
            }
        }

        reportProgress(true);

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
            state.pending = { start: effectiveEnd + 1, end };
        }

        setLineCacheVersion((version) => version + 1);
    }, [getActiveFile]);

    const requestRangeLoad = useCallback((startIndex: number, endIndex: number) => {
        const state = rangeLoadStateRef.current;
        const availableLineCount = lineOffsetsRef.current.length;
        const nextStart = Math.max(0, startIndex - RANGE_LOAD_PADDING);
        const nextEnd = Math.min(endIndex + RANGE_LOAD_PADDING, availableLineCount - 1);

        if (nextEnd < 0) return;

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
    }, [loadLinesForRange]);

    useEffect(() => {
        viewModeRef.current = viewMode;
    }, [viewMode]);

    useEffect(() => {
        if (
            isStreamView
            && viewMode !== ViewModeEnum.FromEnd
            && lineCount === 0
            && tailLoadedRows.length > 0
        ) {
            setTailLoadedRows([]);
        }
    }, [isStreamView, lineCount, tailLoadedRows.length, viewMode]);

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
        if (!isStreamView || lineCount <= MAX_VIRTUAL_ROWS) {
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
    }, [clampWindowStart, lineCount, isStreamView]);

    useEffect(() => {
        if (isStreamView) {
            setNormalRows([]);
            clearParsedRowCache();
            lastSizeRef.current = fileSize;
            return;
        }

        const safeContent = content ?? '';
        const rows = buildRowsForView(safeContent);
        clearParsedRowCache();
        setNormalRows(rows);
        lastSizeRef.current = fileSize;
    }, [clearParsedRowCache, content, fileSize, isStreamView]);

    useEffect(() => {
        if (!isDbView || !analyticsSessionId) {
            setDbLineCount(0);
            setIsRemoteServerDisconnected(false);
            dbLineCacheRef.current = new Map();
            dbCacheBytesRef.current = 0;
            setDbLineCacheVersion((version) => version + 1);
            setDbVirtualWindowStart(0);
            dbRebaseAnchorRef.current = null;
            return;
        }

        if (isIndexing && !isRemoteLargeSession) {
            setDbLineCount(0);
            dbLineCacheRef.current = new Map();
            dbCacheBytesRef.current = 0;
            setDbLineCacheVersion((version) => version + 1);
            setDbVirtualWindowStart(0);
            dbRebaseAnchorRef.current = null;
            return;
        }

        dispatch(clearLogContent());

        let cancelled = false;

        const loadDbLineCount = async () => {
            const isRemoteSession = analyticsSessionId.startsWith('remote:');
            let count = 0;
            try {
                count = await getSessionLineCount(analyticsSessionId);
                if (isRemoteSession) {
                    setIsRemoteServerDisconnected(false);
                }
            } catch {
                if (isRemoteSession) {
                    setIsRemoteServerDisconnected(true);
                }
            }
            const expectedRemoteLineCount = Math.max(0, remoteExpectedLineCountRef.current);

            if (isRemoteSession && count === 0 && expectedRemoteLineCount > 0) {
                count = expectedRemoteLineCount;
            }

            if (isRemoteSession && count === 0) {
                let attempt = 0;
                while (!cancelled && count === 0 && attempt < REMOTE_LINE_COUNT_RETRY_ATTEMPTS) {
                    await new Promise<void>((resolve) => {
                        window.setTimeout(() => resolve(), REMOTE_LINE_COUNT_RETRY_DELAY_MS);
                    });

                    if (cancelled) {
                        return;
                    }

                    try {
                        count = await getSessionLineCount(analyticsSessionId);
                    } catch {
                        // Keep retrying: remote ingest metadata can lag for a short time.
                    }

                    attempt += 1;
                }
            }

            if (isRemoteSession && count === 0 && expectedRemoteLineCount > 0) {
                count = expectedRemoteLineCount;
            }

            if (cancelled) return;
            if (isRemoteSession && count > 0) {
                remoteExpectedLineCountRef.current = count;
            }
            setDbLineCount(count);
            dbLineCacheRef.current = new Map();
            dbCacheBytesRef.current = 0;
            setDbLineCacheVersion((version) => version + 1);
        };

        void loadDbLineCount();

        return () => {
            cancelled = true;
        };
    }, [analyticsSessionId, dispatch, isDbView, isIndexing, isRemoteLargeSession]);

    useEffect(() => {
        if (!isRemoteLargeSession) {
            setIsRemoteServerDisconnected(false);
            return;
        }

        const ingestId = analyticsSessionId.replace('remote:', '');
        if (!ingestId) {
            setIsRemoteServerDisconnected(false);
            return;
        }

        let cancelled = false;

        const checkConnection = async () => {
            try {
                const status = await getRemoteIngestStatus(ingestId);
                if (cancelled) {
                    return;
                }

                setIsRemoteServerDisconnected(false);
                const totalLines = Math.max(0, Number(status.total_lines ?? 0));
                if (totalLines > 0) {
                    remoteExpectedLineCountRef.current = totalLines;
                    setDbLineCount((prev) => (prev === totalLines ? prev : totalLines));
                }
            } catch {
                if (!cancelled) {
                    setIsRemoteServerDisconnected(true);
                }
            }
        };

        void checkConnection();
        const intervalId = window.setInterval(() => {
            void checkConnection();
        }, REMOTE_CONNECTION_RETRY_MS);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [analyticsSessionId, isRemoteLargeSession]);

    const {
        dataFilters,
        anomalySelection,
    } = useMemo(() => splitAnomalyFilter(filters), [filters]);

    const hasActiveFiltersApplied = useMemo(() => hasActiveFilters(filters), [filters]);

    const anomalyIntervals = useMemo<AnomalyLineInterval[]>(() => {
        if (anomalyRegions.length > 0) {
            const normalized = anomalyRegions
                .map((region) => {
                    const start = Math.floor(Math.min(region.start_line, region.end_line));
                    const end = Math.floor(Math.max(region.start_line, region.end_line));
                    return { start, end };
                })
                .filter((region) => Number.isFinite(region.start) && Number.isFinite(region.end) && region.start > 0 && region.end >= region.start)
                .sort((a, b) => a.start - b.start);

            if (normalized.length === 0) {
                return [];
            }

            const merged: AnomalyLineInterval[] = [normalized[0]];
            for (let i = 1; i < normalized.length; i += 1) {
                const current = normalized[i];
                const last = merged[merged.length - 1];
                if (current.start <= last.end + 1) {
                    last.end = Math.max(last.end, current.end);
                } else {
                    merged.push(current);
                }
            }

            return merged;
        }

        if (anomalyLineNumbers.length === 0) {
            return [];
        }

        const sorted = Array.from(new Set(anomalyLineNumbers))
            .filter((lineNumber) => Number.isFinite(lineNumber) && lineNumber > 0)
            .sort((a, b) => a - b);

        if (sorted.length === 0) {
            return [];
        }

        const merged: AnomalyLineInterval[] = [];
        let start = sorted[0];
        let end = sorted[0];

        for (let i = 1; i < sorted.length; i += 1) {
            const current = sorted[i];
            if (current <= end + 1) {
                end = current;
                continue;
            }
            merged.push({ start, end });
            start = current;
            end = current;
        }

        merged.push({ start, end });
        return merged;
    }, [anomalyLineNumbers, anomalyRegions]);

    const isAnomalyLine = useCallback((lineNumber: number): boolean => {
        if (!Number.isFinite(lineNumber) || lineNumber <= 0 || anomalyIntervals.length === 0) {
            return false;
        }

        let left = 0;
        let right = anomalyIntervals.length - 1;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const interval = anomalyIntervals[mid];
            if (lineNumber < interval.start) {
                right = mid - 1;
                continue;
            }
            if (lineNumber > interval.end) {
                left = mid + 1;
                continue;
            }
            return true;
        }

        return false;
    }, [anomalyIntervals]);

    const getAnomalyStatusForLine = useCallback((lineNumber: number): 'anomaly' | 'normal' | undefined => {
        if (!hasAnomalyResults || !Number.isFinite(lineNumber) || lineNumber <= 0) {
            return undefined;
        }

        if (anomalyLastRunParams?.analysisScope !== 'all') {
            return undefined;
        }

        if (anomalyTotalRows > 0 && lineNumber > anomalyTotalRows) {
            return undefined;
        }

        return isAnomalyLine(lineNumber) ? 'anomaly' : 'normal';
    }, [anomalyLastRunParams, anomalyTotalRows, hasAnomalyResults, isAnomalyLine]);

    const applyAnomalyFilterToRows = useCallback((rows: ViewRow[]): ViewRow[] => {
        const { includeAnomaly, includeNormal, includeUndefined } = anomalySelection;
        if (!includeAnomaly && !includeNormal && !includeUndefined) {
            return rows;
        }
        if (!hasAnomalyResults) {
            return includeUndefined ? rows : [];
        }

        return rows.filter((row) => {
            const status = getAnomalyStatusForLine(row.lineNumber);
            if (!status) {
                return includeUndefined;
            }

            if (status === 'anomaly') {
                return includeAnomaly;
            }

            return includeNormal;
        });
    }, [anomalySelection, getAnomalyStatusForLine, hasAnomalyResults]);

    const applyClientSideRowFilters = useCallback((rows: ViewRow[]): ViewRow[] => {
        return applyAnomalyFilterToRows(rows);
    }, [applyAnomalyFilterToRows]);

    useEffect(() => {
        if (hasAnomalyResults) {
            return;
        }

        setFilters((prev) => {
            if (!Array.isArray(prev[ANOMALY_FILTER_KEY])) {
                return prev;
            }
            const next = { ...prev };
            delete next[ANOMALY_FILTER_KEY];
            return next;
        });
    }, [hasAnomalyResults]);

    const mergeRemoteFilteredRows = useCallback((
        prev: ViewRow[],
        chunk: ViewRow[],
        direction: 'older' | 'newer',
        loadFromEnd: boolean,
    ): RemoteFilterMergeResult => {
        if (chunk.length === 0) {
            return {
                rows: prev,
                prependedCount: 0,
                droppedFromStart: 0,
                droppedFromEnd: 0,
            };
        }

        const shouldPrepend = loadFromEnd
            ? direction === 'newer'
            : direction === 'older';

        const merged = shouldPrepend
            ? [...chunk, ...prev]
            : [...prev, ...chunk];

        if (merged.length <= MAX_FILTER_ROWS_IN_MEMORY) {
            return {
                rows: merged,
                prependedCount: shouldPrepend ? chunk.length : 0,
                droppedFromStart: 0,
                droppedFromEnd: 0,
            };
        }

        if (shouldPrepend) {
            const droppedFromEnd = merged.length - MAX_FILTER_ROWS_IN_MEMORY;
            return {
                rows: merged.slice(0, MAX_FILTER_ROWS_IN_MEMORY),
                prependedCount: chunk.length,
                droppedFromStart: 0,
                droppedFromEnd,
            };
        }

        const droppedFromStart = merged.length - MAX_FILTER_ROWS_IN_MEMORY;
        return {
            rows: merged.slice(droppedFromStart),
            prependedCount: 0,
            droppedFromStart,
            droppedFromEnd: 0,
        };
    }, []);

    const loadMoreRemoteFilteredRows = useCallback(async (direction: 'older' | 'newer') => {
        const state = remoteFilterPaginationRef.current;
        const canLoad = direction === 'older' ? state.hasMoreOlder : state.hasMoreNewer;
        if (!state.active || state.isLoading || !canLoad || !analyticsSessionId) {
            return;
        }

        const cursor = direction === 'older' ? state.oldestLineNumber : state.newestLineNumber;
        if (!cursor || cursor <= 0) {
            return;
        }

        state.isLoading = true;
        try {
            const result = await queryFilteredLines(analyticsSessionId, dataFilters, {
                limit: REMOTE_FILTER_PAGE_ROWS,
                afterLine: direction === 'newer' ? cursor : undefined,
                beforeLine: direction === 'older' ? cursor : undefined,
                order: direction === 'older' ? 'desc' : 'asc',
            });

            if (!remoteFilterPaginationRef.current.active) {
                return;
            }

            const queryIsDesc = direction === 'older';
            const displayIsDesc = state.loadFromEnd;
            const pageRowsDisplayRaw = queryIsDesc === displayIsDesc
                ? result.lines
                : result.lines.slice().reverse();
            const pageRowsDisplay = applyClientSideRowFilters(pageRowsDisplayRaw);

            if (pageRowsDisplay.length > 0) {
                let prependedCount = 0;
                let droppedFromStart = 0;
                let droppedFromEnd = 0;
                let mergedFirstLine: number | undefined;
                let mergedLastLine: number | undefined;
                const previousRangeStart = remoteFilteredRangeRef.current.start;
                setIndexedFilteredRows((prev) => {
                    const mergeResult = mergeRemoteFilteredRows(prev, pageRowsDisplay, direction, state.loadFromEnd);
                    prependedCount = mergeResult.prependedCount;
                    droppedFromStart = mergeResult.droppedFromStart;
                    droppedFromEnd = mergeResult.droppedFromEnd;
                    if (mergeResult.rows.length > 0) {
                        mergedFirstLine = mergeResult.rows[0].lineNumber;
                        mergedLastLine = mergeResult.rows[mergeResult.rows.length - 1].lineNumber;
                    }
                    return mergeResult.rows;
                });

                if (prependedCount > 0 || droppedFromStart > 0) {
                    const nextAnchor = Math.max(
                        0,
                        previousRangeStart + prependedCount - droppedFromStart,
                    );
                    requestAnimationFrame(() => {
                        virtuosoRef.current?.scrollToIndex({
                            index: nextAnchor,
                            align: 'start',
                            behavior: 'auto',
                        });
                    });
                }

                if (droppedFromStart > 0) {
                    if (state.loadFromEnd) {
                        state.hasMoreNewer = true;
                    } else {
                        state.hasMoreOlder = true;
                    }
                }

                if (droppedFromEnd > 0) {
                    if (state.loadFromEnd) {
                        state.hasMoreOlder = true;
                    } else {
                        state.hasMoreNewer = true;
                    }
                }

                if (state.loadFromEnd) {
                    if (mergedLastLine !== undefined) {
                        state.oldestLineNumber = mergedLastLine;
                    }
                    if (mergedFirstLine !== undefined) {
                        state.newestLineNumber = mergedFirstLine;
                    }
                } else {
                    if (mergedFirstLine !== undefined) {
                        state.oldestLineNumber = mergedFirstLine;
                    }
                    if (mergedLastLine !== undefined) {
                        state.newestLineNumber = mergedLastLine;
                    }
                }
            }

            if (direction === 'older') {
                const nextOlder = result.nextBeforeLine
                    ?? (pageRowsDisplayRaw.length > 0 ? pageRowsDisplayRaw[pageRowsDisplayRaw.length - 1].lineNumber : undefined);
                if (nextOlder !== undefined) {
                    state.oldestLineNumber = nextOlder;
                }
            } else {
                const nextNewer = result.nextAfterLine
                    ?? (pageRowsDisplayRaw.length > 0 ? pageRowsDisplayRaw[pageRowsDisplayRaw.length - 1].lineNumber : undefined);
                if (nextNewer !== undefined) {
                    state.newestLineNumber = nextNewer;
                }
            }

            const hasMore = Boolean(result.hasMore ?? (pageRowsDisplayRaw.length >= REMOTE_FILTER_PAGE_ROWS));
            if (direction === 'older') {
                state.hasMoreOlder = hasMore;
            } else {
                state.hasMoreNewer = hasMore;
            }
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.error('Failed to load more remote filtered rows:', error);
            }
        } finally {
            state.isLoading = false;
        }
    }, [analyticsSessionId, applyClientSideRowFilters, dataFilters, mergeRemoteFilteredRows]);

    useEffect(() => {
        if (isStreamView || !analyticsSessionId || !hasActiveFiltersApplied) {
            remoteFilterPaginationRef.current = {
                active: false,
                loadFromEnd: false,
                hasMoreOlder: false,
                hasMoreNewer: false,
                isLoading: false,
            };
            setIndexedFilteredRows([]);
            setIsFilteringRows(false);
            return;
        }

        let cancelled = false;
        const controller = new AbortController();
        const loadFromEnd = viewMode === ViewModeEnum.FromEnd;

        remoteFilterPaginationRef.current = {
            active: true,
            loadFromEnd,
            hasMoreOlder: false,
            hasMoreNewer: false,
            isLoading: false,
        };

        setIndexedFilteredRows([]);
        setIsFilteringRows(true);

        const run = async () => {
            try {
                const initialDirection = loadFromEnd ? 'desc' : 'asc';
                const seedRows: ViewRow[] = [];
                let guard = 0;
                let hasMore = false;
                let afterLine: number | undefined;
                let beforeLine: number | undefined;
                let firstRawLine: number | undefined;
                let lastRawLine: number | undefined;

                while (!cancelled && guard < 50) {
                    const result = await queryFilteredLines(analyticsSessionId, dataFilters, {
                        limit: REMOTE_FILTER_PAGE_ROWS,
                        order: initialDirection,
                        afterLine,
                        beforeLine,
                        signal: controller.signal,
                    });

                    if (cancelled) return;

                    const rawPage = result.lines;
                    if (rawPage.length === 0) {
                        hasMore = false;
                        break;
                    }

                    if (firstRawLine === undefined) {
                        firstRawLine = rawPage[0].lineNumber;
                    }
                    lastRawLine = rawPage[rawPage.length - 1].lineNumber;

                    const filteredPage = applyClientSideRowFilters(rawPage);
                    if (filteredPage.length > 0) {
                        seedRows.push(...filteredPage);
                    }

                    hasMore = Boolean(result.hasMore ?? (rawPage.length >= REMOTE_FILTER_PAGE_ROWS));

                    if (initialDirection === 'desc') {
                        beforeLine = result.nextBeforeLine ?? lastRawLine;
                        if (!beforeLine || beforeLine <= 0) {
                            hasMore = false;
                            break;
                        }
                    } else {
                        afterLine = result.nextAfterLine ?? lastRawLine;
                        if (!afterLine || afterLine <= 0) {
                            hasMore = false;
                            break;
                        }
                    }

                    if (!hasMore || seedRows.length > 0) {
                        break;
                    }

                    guard += 1;
                }

                if (cancelled) return;

                setIndexedFilteredRows(seedRows);

                const pagination = remoteFilterPaginationRef.current;
                pagination.active = true;
                pagination.loadFromEnd = loadFromEnd;
                pagination.oldestLineNumber = undefined;
                pagination.newestLineNumber = undefined;

                if (firstRawLine !== undefined) {
                    pagination.newestLineNumber = firstRawLine;
                }
                if (lastRawLine !== undefined) {
                    pagination.oldestLineNumber = lastRawLine;
                }

                if (loadFromEnd) {
                    if (beforeLine !== undefined && beforeLine > 0) {
                        pagination.oldestLineNumber = beforeLine;
                    }
                    pagination.hasMoreOlder = hasMore;
                    pagination.hasMoreNewer = false;
                } else {
                    if (afterLine !== undefined && afterLine > 0) {
                        pagination.newestLineNumber = afterLine;
                    }
                    pagination.hasMoreOlder = false;
                    pagination.hasMoreNewer = hasMore;
                }
            } catch (error) {
                if ((error as Error).name !== 'AbortError') {
                    console.error('Indexed filter query failed:', error);
                }
            } finally {
                if (!cancelled) {
                    setIsFilteringRows(false);
                }
            }
        };

        void run();

        return () => {
            cancelled = true;
            remoteFilterPaginationRef.current = {
                active: false,
                loadFromEnd: false,
                hasMoreOlder: false,
                hasMoreNewer: false,
                isLoading: false,
            };
            controller.abort();
        };
    }, [
        analyticsSessionId,
        applyClientSideRowFilters,
        dataFilters,
        hasActiveFiltersApplied,
        isStreamView,
        viewMode,
    ]);

    const filteredRows = useMemo(() => {
        if (isStreamView) {
            return [];
        }

        if (!hasActiveFiltersApplied) {
            if (isDbView) {
                return [];
            }
            return normalRows;
        }

        if (analyticsSessionId) {
            return indexedFilteredRows;
        }

        const parsedRows = normalRows.map((row) => getParsedRow(row));
        const filteredParsed = applyLogFilters(parsedRows, dataFilters);
        const baseRows = filteredParsed.map((row) => ({ lineNumber: row.lineNumber, raw: row.raw }));
        return applyAnomalyFilterToRows(baseRows);
    }, [
        analyticsSessionId,
        applyAnomalyFilterToRows,
        dataFilters,
        hasActiveFiltersApplied,
        getParsedRow,
        indexedFilteredRows,
        isDbView,
        isStreamView,
        normalRows,
    ]);

    const displayLines = useMemo(() => {
        if (isStreamView) {
            return [];
        }

        if (isDbView && !hasActiveFiltersApplied) {
            return [];
        }

        if (isRemoteLargeSession && hasActiveFiltersApplied) {
            return [];
        }

        if (isDbView && hasActiveFiltersApplied) {
            return [];
        }

        if (viewMode === ViewModeEnum.FromEnd) {
            return filteredRows.slice().reverse().map((row) => ({
                raw: row.raw,
                displayLineNumber: row.lineNumber,
                sourceLineNumber: row.lineNumber,
                anomalyStatus: getAnomalyStatusForLine(row.lineNumber),
            }));
        }

        return filteredRows.map((row) => ({
            raw: row.raw,
            displayLineNumber: row.lineNumber,
            sourceLineNumber: row.lineNumber,
            anomalyStatus: getAnomalyStatusForLine(row.lineNumber),
        }));
    }, [filteredRows, getAnomalyStatusForLine, hasActiveFiltersApplied, isDbView, isRemoteLargeSession, isStreamView, viewMode]);

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
        if (!isDbView || dbLineCount === 0) return null;

        const globalDisplayIndex = dbVirtualWindowStart + displayIndex;

        const fileIndex = viewMode === ViewModeEnum.FromEnd
            ? dbLineCount - 1 - globalDisplayIndex
            : globalDisplayIndex;

        if (fileIndex < 0 || fileIndex >= dbLineCount) return null;

        const rawEntry = dbLineCacheRef.current.get(fileIndex);
        const sourceLineNumber = fileIndex + 1;

        const displayLineNumber = viewMode === ViewModeEnum.FromEnd
            ? dbLineCount - globalDisplayIndex
            : fileIndex + 1;

        if (!rawEntry) {
            return {
                raw: t('common.loading'),
                displayLineNumber,
                sourceLineNumber,
                anomalyStatus: getAnomalyStatusForLine(sourceLineNumber),
                parseState: 'loading' as const,
            };
        }

        return {
            raw: rawEntry.text,
            displayLineNumber,
            sourceLineNumber,
            anomalyStatus: getAnomalyStatusForLine(sourceLineNumber),
            ...buildLineParsePreview(sourceLineNumber, rawEntry.text),
        };
    }, [buildLineParsePreview, dbLineCount, dbVirtualWindowStart, getAnomalyStatusForLine, isDbView, viewMode, dbLineCacheVersion, t]);

    const getLineAtIndex = useCallback((displayIndex: number) => {
        if (!isStreamView) {
            if (isDbView && hasActiveFiltersApplied) {
                const row = indexedFilteredRows[displayIndex];
                if (!row) return null;
                return {
                    raw: row.raw,
                    displayLineNumber: row.lineNumber,
                    sourceLineNumber: row.lineNumber,
                    anomalyStatus: getAnomalyStatusForLine(row.lineNumber),
                    ...buildLineParsePreview(row.lineNumber, row.raw),
                };
            }
            if (isDbView && !hasActiveFiltersApplied) {
                return getDbLineAtIndex(displayIndex);
            }
            const row = displayLines[displayIndex];
            if (!row) {
                return null;
            }

            const sourceLineNumber = row.sourceLineNumber ?? row.displayLineNumber;
            return {
                ...row,
                ...buildLineParsePreview(sourceLineNumber, row.raw),
            };
        }

        if (lineCount === 0) return null;

        const globalDisplayIndex = virtualWindowStart + displayIndex;

        const fileIndex = viewMode === ViewModeEnum.FromEnd
            ? lineCount - 1 - globalDisplayIndex
            : globalDisplayIndex;

        if (fileIndex < 0 || fileIndex >= lineCount) return null;

        const rawEntry = lineCacheRef.current.get(fileIndex);
        const sourceLineNumber = fileIndex + 1;

        const displayLineNumber = viewMode === ViewModeEnum.FromEnd
            ? lineCount - globalDisplayIndex
            : fileIndex + 1;

        if (!rawEntry) {
            return {
                raw: t('common.loading'),
                displayLineNumber,
                sourceLineNumber,
                anomalyStatus: getAnomalyStatusForLine(sourceLineNumber),
                parseState: 'loading' as const,
            };
        }

        return {
            raw: rawEntry.text,
            displayLineNumber,
            sourceLineNumber,
            anomalyStatus: getAnomalyStatusForLine(sourceLineNumber),
            ...buildLineParsePreview(sourceLineNumber, rawEntry.text),
        };
    }, [buildLineParsePreview, displayLines, getAnomalyStatusForLine, indexedFilteredRows, lineCount, viewMode, lineCacheVersion, virtualWindowStart, isStreamView, hasActiveFiltersApplied, getDbLineAtIndex, isDbView, t]);

    const handleRangeChange = useCallback((startIndex: number, endIndex: number) => {
        if (!isStreamView || lineCount === 0) return;

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
        requestRangeLoad,
        lineCount,
        viewMode,
        virtualWindowStart,
        isStreamView,
    ]);

    const handleDbRangeChange = useCallback((startIndex: number, endIndex: number) => {
        if (!isDbView || hasActiveFilters(filters) || dbLineCount === 0) return;

        const virtualCount = getVirtualWindowSize(dbVirtualWindowStart, dbLineCount);
        const safeStart = Math.max(0, Math.min(startIndex, Math.max(0, virtualCount - 1)));
        const safeEnd = Math.max(0, Math.min(endIndex, Math.max(0, virtualCount - 1)));
        const globalStart = dbVirtualWindowStart + safeStart;
        const globalEnd = dbVirtualWindowStart + safeEnd;

        if (viewMode === ViewModeEnum.FromEnd) {
            const mappedStart = dbLineCount - 1 - globalEnd;
            const mappedEnd = dbLineCount - 1 - globalStart;
            requestDbRangeLoad(mappedStart, mappedEnd);
        } else {
            requestDbRangeLoad(globalStart, globalEnd);
        }

        if (dbLineCount <= MAX_VIRTUAL_ROWS) return;

        const nearTop = safeStart < WINDOW_REBASE_MARGIN;
        const nearBottom = safeEnd > Math.max(0, virtualCount - 1 - WINDOW_REBASE_MARGIN);

        if (!nearTop && !nearBottom) return;

        const globalAnchor = Math.floor((globalStart + globalEnd) / 2);
        const nextWindowStart = clampWindowStart(
            globalAnchor - Math.floor(MAX_VIRTUAL_ROWS / 2),
            dbLineCount,
        );

        if (nextWindowStart === dbVirtualWindowStart) return;

        dbRebaseAnchorRef.current = Math.max(0, globalAnchor - nextWindowStart);
        setDbVirtualWindowStart(nextWindowStart);
    }, [clampWindowStart, dbLineCount, dbVirtualWindowStart, filters, getVirtualWindowSize, requestDbRangeLoad, isDbView, viewMode]);

    const handleRemoteFilteredRangeChange = useCallback((startIndex: number, endIndex: number) => {
        if (!isDbView || !hasActiveFiltersApplied) {
            return;
        }

        const previousStart = remoteFilteredRangeRef.current.start;
        remoteFilteredRangeRef.current = {
            start: startIndex,
            end: endIndex,
            previousStart,
        };

        const count = indexedFilteredRows.length;
        if (count === 0) {
            return;
        }

        const edgeThreshold = Math.min(REMOTE_FILTER_LOAD_EDGE_ROWS, Math.max(20, Math.floor(count * 0.2)));
        const nearTop = startIndex <= edgeThreshold;
        const nearBottom = endIndex >= Math.max(0, count - 1 - edgeThreshold);

        if (!nearTop && !nearBottom) {
            return;
        }

        const movingDown = startIndex > previousStart;

        const topDirection = viewMode === ViewModeEnum.FromEnd ? 'newer' : 'older';
        const bottomDirection = viewMode === ViewModeEnum.FromEnd ? 'older' : 'newer';

        if (nearTop && nearBottom) {
            void loadMoreRemoteFilteredRows(movingDown ? bottomDirection : topDirection);
            return;
        }

        if (nearTop) {
            void loadMoreRemoteFilteredRows(topDirection);
            return;
        }

        if (nearBottom) {
            void loadMoreRemoteFilteredRows(bottomDirection);
        }
    }, [indexedFilteredRows.length, hasActiveFiltersApplied, isDbView, loadMoreRemoteFilteredRows, viewMode]);

    useEffect(() => {
        if (!isDbView || hasActiveFilters(filters)) {
            setDbVirtualWindowStart(0);
            dbRebaseAnchorRef.current = null;
            return;
        }

        setDbVirtualWindowStart((current) => clampWindowStart(current, dbLineCount));
    }, [clampWindowStart, dbLineCount, filters, isDbView]);

    useEffect(() => {
        if (!isDbView || hasActiveFilters(filters) || dbLineCount === 0) {
            return;
        }

        const virtualCount = getVirtualWindowSize(dbVirtualWindowStart, dbLineCount);
        const preloadEndLocal = Math.min(DB_RANGE_LOAD_PADDING, Math.max(0, virtualCount - 1));
        const globalStart = dbVirtualWindowStart;
        const globalEnd = dbVirtualWindowStart + preloadEndLocal;

        if (viewMode === ViewModeEnum.FromEnd) {
            const mappedStart = Math.max(0, dbLineCount - 1 - globalEnd);
            const mappedEnd = dbLineCount - 1 - globalStart;
            requestDbRangeLoad(mappedStart, mappedEnd);
        } else {
            requestDbRangeLoad(globalStart, globalEnd);
        }
    }, [dbLineCount, dbVirtualWindowStart, filters, getVirtualWindowSize, requestDbRangeLoad, isDbView, viewMode]);

    useEffect(() => {
        if (!isDbView || hasActiveFilters(filters)) return;
        if (dbRebaseAnchorRef.current === null) return;
        if (!virtuosoRef.current) return;

        const virtualCount = getVirtualWindowSize(dbVirtualWindowStart, dbLineCount);
        if (virtualCount <= 0) return;

        const anchor = Math.max(0, Math.min(dbRebaseAnchorRef.current, virtualCount - 1));
        virtuosoRef.current.scrollToIndex({ index: anchor, align: 'center', behavior: 'auto' });
        dbRebaseAnchorRef.current = null;
    }, [dbLineCount, dbVirtualWindowStart, filters, getVirtualWindowSize, isDbView]);

    useEffect(() => {
        if (isStreamView || !analyticsSessionId || isIndexing) {
            setIndexedHistogramLines([]);
            setIsHistogramLoading(false);
            return;
        }

        let cancelled = false;
        setIsHistogramLoading(true);

        const loadHistogramSample = async () => {
            const snapshot = await getDashboardSnapshot(analyticsSessionId);
            if (cancelled) return;

            const normalized = (snapshot?.sampledLines ?? []).flatMap((line) => {
                const raw = typeof line.raw === 'string' ? line.raw : '';
                const lineNumber = Number(line.lineNumber);
                if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
                    return [];
                }

                let parsed = line.parsed;
                if (!parsed || Object.keys(parsed.fields ?? {}).length === 0) {
                    const reparsed = raw.trim().length > 0 ? parseLogLineAuto(raw) : null;
                    if (reparsed) {
                        parsed = reparsed;
                    }
                }

                if (parsed && !parsed.fields.timestamp) {
                    const sourceTimestamp = (line as unknown as { timestamp_iso?: unknown }).timestamp_iso;
                    if (typeof sourceTimestamp === 'string' && sourceTimestamp.trim()) {
                        parsed = {
                            ...parsed,
                            fields: {
                                ...parsed.fields,
                                timestamp: sourceTimestamp,
                            },
                        };
                    }
                }

                return [{
                    lineNumber,
                    raw,
                    parsed,
                }];
            });
            setIndexedHistogramLines(normalized);
        };

        void loadHistogramSample().finally(() => {
            if (!cancelled) {
                setIsHistogramLoading(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [analyticsSessionId, isIndexing, isStreamView]);

    const handleAnomalyRangeSelect = useCallback((startLine: number, endLine: number) => {
        const normalizedStart = Math.min(startLine, endLine);
        const normalizedEnd = Math.max(startLine, endLine);
        const targetSourceLine = viewMode === ViewModeEnum.FromEnd ? normalizedEnd : normalizedStart;

        if (targetSourceLine <= 0 || !Number.isFinite(targetSourceLine)) {
            return;
        }

        if (isStreamView) {
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

        if (isDbView && !hasActiveFiltersApplied) {
            if (!virtuosoRef.current || dbLineCount <= 0) return;

            const fileIndex = Math.max(0, Math.min(dbLineCount - 1, Math.floor(targetSourceLine) - 1));
            const globalDisplayIndex = viewMode === ViewModeEnum.FromEnd
                ? Math.max(0, dbLineCount - 1 - fileIndex)
                : fileIndex;

            const currentVirtualCount = getVirtualWindowSize(dbVirtualWindowStart, dbLineCount);
            const localIndexInCurrentWindow = globalDisplayIndex - dbVirtualWindowStart;
            const isInsideCurrentWindow = (
                localIndexInCurrentWindow >= 0
                && localIndexInCurrentWindow < currentVirtualCount
            );

            if (isInsideCurrentWindow) {
                dbRebaseAnchorRef.current = null;
                setSelectedLine(Math.floor(targetSourceLine));
                virtuosoRef.current.scrollToIndex({
                    index: localIndexInCurrentWindow,
                    align: 'center',
                    behavior: 'auto',
                });
                return;
            }

            const nextWindowStart = clampWindowStart(
                globalDisplayIndex - Math.floor(MAX_VIRTUAL_ROWS / 2),
                dbLineCount,
            );
            dbRebaseAnchorRef.current = Math.max(0, globalDisplayIndex - nextWindowStart);
            setDbVirtualWindowStart(nextWindowStart);
            setSelectedLine(Math.floor(targetSourceLine));
            return;
        }

        if (isDbView && hasActiveFiltersApplied) {
            if (!virtuosoRef.current || indexedFilteredRows.length === 0) return;

            let targetIndex = indexedFilteredRows.findIndex((line) => line.lineNumber === targetSourceLine);
            if (targetIndex < 0) {
                let bestIndex = -1;
                let bestDistance = Number.POSITIVE_INFINITY;

                for (let i = 0; i < indexedFilteredRows.length; i += 1) {
                    const source = indexedFilteredRows[i].lineNumber;
                    const distance = Math.abs(source - targetSourceLine);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestIndex = i;
                    }
                }

                targetIndex = bestIndex;
            }

            if (targetIndex < 0) {
                return;
            }

            const targetLine = indexedFilteredRows[targetIndex];
            setSelectedLine(targetLine.lineNumber);
            virtuosoRef.current.scrollToIndex({ index: targetIndex, align: 'center', behavior: 'auto' });
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
        setSelectedLine(targetLine.sourceLineNumber ?? targetLine.displayLineNumber);
        virtuosoRef.current.scrollToIndex({ index: targetIndex, align: 'center', behavior: 'auto' });
    }, [
        clampWindowStart,
        dbLineCount,
        dbVirtualWindowStart,
        displayLines,
        getVirtualWindowSize,
        hasActiveFiltersApplied,
        isDbView,
        indexedFilteredRows,
        lineCount,
        setWindowAroundDisplayIndex,
        viewMode,
        virtualWindowStart,
        isStreamView,
    ]);

    const getAdjacentAnomalyLine = useCallback((
        direction: 'up' | 'down',
        fromLine: number | null,
    ): number | null => {
        if (anomalyIntervals.length === 0) {
            return null;
        }

        const minAnomalyLine = anomalyIntervals[0].start;
        const maxAnomalyLine = anomalyIntervals[anomalyIntervals.length - 1].end;

        const moveTowardsGreaterLine = direction === 'down'
            ? viewMode !== ViewModeEnum.FromEnd
            : viewMode === ViewModeEnum.FromEnd;

        const normalizedCurrent = fromLine !== null && Number.isFinite(fromLine)
            ? Math.floor(fromLine)
            : null;

        if (!normalizedCurrent || normalizedCurrent <= 0) {
            return moveTowardsGreaterLine ? minAnomalyLine : maxAnomalyLine;
        }

        if (moveTowardsGreaterLine) {
            for (let i = 0; i < anomalyIntervals.length; i += 1) {
                const interval = anomalyIntervals[i];
                if (normalizedCurrent < interval.start) {
                    return interval.start;
                }
                if (normalizedCurrent >= interval.start && normalizedCurrent < interval.end) {
                    return normalizedCurrent + 1;
                }
            }

            // Circular navigation: after the last anomaly jump to the first.
            return minAnomalyLine;
        }

        for (let i = anomalyIntervals.length - 1; i >= 0; i -= 1) {
            const interval = anomalyIntervals[i];
            if (normalizedCurrent > interval.end) {
                return interval.end;
            }
            if (normalizedCurrent > interval.start && normalizedCurrent <= interval.end) {
                return normalizedCurrent - 1;
            }
        }

        // Circular navigation: before the first anomaly jump to the last.
        return maxAnomalyLine;
    }, [anomalyIntervals, viewMode]);

    const previousAnomalyTargetLine = useMemo(
        () => getAdjacentAnomalyLine('up', selectedLine),
        [getAdjacentAnomalyLine, selectedLine],
    );

    const nextAnomalyTargetLine = useMemo(
        () => getAdjacentAnomalyLine('down', selectedLine),
        [getAdjacentAnomalyLine, selectedLine],
    );

    const navigateToAdjacentAnomaly = useCallback((direction: 'up' | 'down') => {
        const targetLine = getAdjacentAnomalyLine(direction, selectedLine);
        if (targetLine === null) {
            return;
        }

        handleAnomalyRangeSelect(targetLine, targetLine);
    }, [getAdjacentAnomalyLine, handleAnomalyRangeSelect, selectedLine]);

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

    const timelineFilterField = useMemo(() => {
        const dateField = fieldDefinitions.find((field) => field.type === 'datetime' && field.name.trim().length > 0);
        return dateField?.name ?? TIMELINE_FILTER_FALLBACK_FIELD;
    }, [fieldDefinitions]);

    const selectedHistogramTimeRange = useMemo<{ start: number | null; end: number | null }>(() => {
        const value = filters[timelineFilterField];
        if (!value || typeof value !== 'object' || Array.isArray(value) || (!('start' in value) && !('end' in value))) {
            return { start: null, end: null };
        }

        const range = value as { start?: unknown; end?: unknown };
        const startMs = range.start instanceof Date && Number.isFinite(range.start.getTime())
            ? range.start.getTime()
            : null;
        const endMs = range.end instanceof Date && Number.isFinite(range.end.getTime())
            ? range.end.getTime()
            : null;

        return { start: startMs, end: endMs };
    }, [filters, timelineFilterField]);

    const handleHistogramTimeRangeChange = useCallback((startTime: number | null, endTime: number | null) => {
        if (timelineFilterTimerRef.current !== null) {
            window.clearTimeout(timelineFilterTimerRef.current);
        }

        const normalizedStart = typeof startTime === 'number' && Number.isFinite(startTime)
            ? startTime
            : null;
        const normalizedEnd = typeof endTime === 'number' && Number.isFinite(endTime)
            ? endTime
            : null;

        timelineFilterTimerRef.current = window.setTimeout(() => {
            timelineFilterTimerRef.current = null;

            setFilters((prev) => {
                let changed = false;
                const next: LogFilters = { ...prev };
                const previousTimelineField = timelineFilterFieldRef.current;

                if (previousTimelineField !== timelineFilterField && previousTimelineField in next) {
                    delete next[previousTimelineField];
                    changed = true;
                }

                timelineFilterFieldRef.current = timelineFilterField;

                if (normalizedStart === null && normalizedEnd === null) {
                    if (timelineFilterField in next) {
                        delete next[timelineFilterField];
                        changed = true;
                    }

                    return changed ? next : prev;
                }

                const existing = next[timelineFilterField];
                const existingIsDateRange = (
                    typeof existing === 'object'
                    && existing !== null
                    && !Array.isArray(existing)
                    && ('start' in existing || 'end' in existing)
                );

                const existingStartMs = existingIsDateRange
                    ? (existing.start ? existing.start.getTime() : null)
                    : null;
                const existingEndMs = existingIsDateRange
                    ? (existing.end ? existing.end.getTime() : null)
                    : null;

                if (existingStartMs === normalizedStart && existingEndMs === normalizedEnd) {
                    return changed ? next : prev;
                }

                next[timelineFilterField] = {
                    start: normalizedStart !== null ? new Date(normalizedStart) : null,
                    end: normalizedEnd !== null ? new Date(normalizedEnd) : null,
                };
                return next;
            });
        }, TIMELINE_FILTER_DEBOUNCE_MS);
    }, [timelineFilterField]);

    useEffect(() => {
        return () => {
            if (timelineFilterTimerRef.current !== null) {
                window.clearTimeout(timelineFilterTimerRef.current);
                timelineFilterTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!isStreamView) return;

        const cached = largeFileViewCache.get(largeFileCacheKey);
        if (cached) {
            lineOffsetsRef.current = cached.lineOffsets;
            setLineCount(cached.lineCount);
            setTailLoadedRows([]);

            lineCacheRef.current = new Map();
            cacheBytesRef.current = 0;
            setLineCacheVersion((version) => version + 1);

            if (cached.lineCount > 0) {
                if (viewModeRef.current === ViewModeEnum.FromEnd) {
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
            const waitForActiveFile = async (): Promise<File | null> => {
                while (!cancelled) {
                    const activeFile = await getActiveFile();
                    if (activeFile) {
                        return activeFile;
                    }

                    await new Promise<void>((resolve) => {
                        window.setTimeout(() => resolve(), 60);
                    });
                }

                return null;
            };

            const file = await waitForActiveFile();
            if (!file) return;

            const loadFromEnd = viewModeRef.current === ViewModeEnum.FromEnd;
            if (loadFromEnd) {
                try {
                    const rows = await loadTailRows(file);
                    if (!cancelled) {
                        setTailLoadedRows(rows);
                    }
                } catch (error) {
                    console.error('Failed to load tail rows:', error);
                }
            } else {
                setTailLoadedRows([]);
            }

            lastModifiedRef.current = file.lastModified;
            lastSizeRef.current = file.size;
            lineCacheRef.current = new Map();
            cacheBytesRef.current = 0;
            setLineCacheVersion((version) => version + 1);
            lineOffsetsRef.current = createLineIndex();
            setLineCount(0);

            const offsets = await buildLineIndex(file, {
                isCancelled: () => cancelled,
                onProgress: loadFromEnd
                    ? undefined
                    : (nextOffsets, nextLineCount) => {
                        if (cancelled) return;
                        lineOffsetsRef.current = nextOffsets;
                        setLineCount(nextLineCount);
                    },
            });
            if (cancelled) return;

            lineOffsetsRef.current = offsets;
            setLineCount(offsets.length);
            setTailLoadedRows([]);
            setLargeFileViewCache(largeFileCacheKey, {
                lineOffsets: offsets,
                lineCount: offsets.length,
            });

            if (offsets.length > 0) {
                if (viewModeRef.current === ViewModeEnum.FromEnd) {
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
    }, [buildLineIndex, getActiveFile, largeFileCacheKey, loadTailRows, requestRangeLoad, isStreamView]);

    useEffect(() => {
        if (isStreamView) {
            return;
        }

        if (tailLoadedRows.length > 0) {
            setTailLoadedRows([]);
        }
    }, [isStreamView, tailLoadedRows.length]);

    useEffect(() => {
        if (!isStreamView || lineCount === 0) return;

        if (viewMode === ViewModeEnum.FromEnd) {
            const start = Math.max(0, lineCount - 1 - RANGE_LOAD_PADDING);
            requestRangeLoad(start, lineCount - 1);
        } else {
            requestRangeLoad(0, Math.min(RANGE_LOAD_PADDING, lineCount - 1));
        }
    }, [lineCount, requestRangeLoad, isStreamView, viewMode]);

    useEffect(() => {
        if (!isStreamView) {
            setVirtualWindowStart(0);
            return;
        }

        setVirtualWindowStart((current) => clampWindowStart(current, lineCount));
    }, [clampWindowStart, lineCount, isStreamView]);

    useEffect(() => {
        if (isStreamView) {
            return;
        }

        const hasStreamState = (
            lineOffsetsRef.current.length > 0
            || lineCacheRef.current.size > 0
            || cacheBytesRef.current > 0
            || lineCount > 0
            || tailLoadedRows.length > 0
            || virtualWindowStart !== 0
        );

        if (!hasStreamState) {
            return;
        }

        lineOffsetsRef.current = createLineIndex();
        lineCacheRef.current = new Map();
        cacheBytesRef.current = 0;
        rebaseAnchorRef.current = null;
        setLineCount(0);
        setTailLoadedRows([]);
        setVirtualWindowStart(0);
        setLineCacheVersion((version) => version + 1);
        largeFileViewCache.clear();
    }, [isStreamView, lineCount, tailLoadedRows.length, virtualWindowStart]);

    useEffect(() => {
        if (!isStreamView) return;
        if (rebaseAnchorRef.current === null) return;
        if (!virtuosoRef.current) return;

        const virtualCount = getVirtualWindowSize(virtualWindowStart, lineCount);
        if (virtualCount <= 0) return;

        const anchor = Math.max(0, Math.min(rebaseAnchorRef.current, virtualCount - 1));
        virtuosoRef.current.scrollToIndex({ index: anchor, align: 'center', behavior: 'auto' });
        rebaseAnchorRef.current = null;
    }, [getVirtualWindowSize, lineCount, isStreamView, virtualWindowStart]);

    useEffect(() => {
        if (!autoRefresh) return;
        if (isLargeFile) return;
        if (anomalyIsRunning) return;
        if (isRemoteLargeSession) return;

        let intervalId: number | null = null;

        const pollOnce = async () => {
            try {
                const fileHandle = getFileHandle();
                if (!fileHandle) {
                    return;
                }

                const file = await fileHandle.getFile();
                const currentSize = file.size;

                if (lastModifiedRef.current === 0 && lastSizeRef.current === 0) {
                    lastModifiedRef.current = file.lastModified;
                    lastSizeRef.current = currentSize;
                    return;
                }

                const hasMetadataChanged = file.lastModified !== lastModifiedRef.current || currentSize !== lastSizeRef.current;

                if (isDbView && analyticsSessionId) {
                    const previousDbLineCount = dbLineCount;
                    const result = await appendLogFileToIndex(file, analyticsSessionId);
                    if (result) {
                        setDbLineCount(result.newLineCount);
                        if (result.addedLines <= 0 && (result.newLineCount > 0 || previousDbLineCount > 0)) {
                            const lastLineCount = result.newLineCount > 0 ? result.newLineCount : previousDbLineCount;
                            void refreshLastDbLineCache(lastLineCount);
                        }
                        lastModifiedRef.current = result.newLastModified;
                        lastSizeRef.current = result.newFileSize;
                    } else {
                        lastModifiedRef.current = file.lastModified;
                        lastSizeRef.current = currentSize;
                    }

                    if (hasMetadataChanged) {
                        dispatch(updateLogContent({
                            content: '',
                            lastModified: file.lastModified,
                            size: currentSize,
                        }));
                    }

                    return;
                }

                if (!hasMetadataChanged) {
                    return;
                }

                lastModifiedRef.current = file.lastModified;

                if (isStreamView) {
                    if (currentSize < lastSizeRef.current) {
                        const offsets = await buildLineIndex(file);
                        lineOffsetsRef.current = offsets;
                        lineCacheRef.current = new Map();
                        cacheBytesRef.current = 0;
                        setLineCacheVersion((version) => version + 1);
                        setLineCount(offsets.length);
                        lastSizeRef.current = currentSize;
                    } else if (currentSize > lastSizeRef.current) {
                        const buffer = await file.slice(lastSizeRef.current, currentSize).arrayBuffer();
                        const bytes = new Uint8Array(buffer);
                        const offsets = lineOffsetsRef.current;
                        for (let i = 0; i < bytes.length; i += 1) {
                            if (bytes[i] === 10) {
                                pushOffset(offsets, lastSizeRef.current + i + 1);
                            }
                        }

                        setLineCount(offsets.length);
                        lastSizeRef.current = currentSize;

                        if (viewMode === ViewModeEnum.FromEnd && offsets.length > 0) {
                            const start = Math.max(0, offsets.length - 1 - RANGE_LOAD_PADDING);
                            requestRangeLoad(start, offsets.length - 1);
                        }
                    }

                    return;
                }

                const preview = await file.slice(0, Math.min(file.size, PREVIEW_BYTES)).text();
                dispatch(updateLogContent({
                    content: preview,
                    lastModified: file.lastModified,
                    size: currentSize,
                }));

                lastSizeRef.current = currentSize;
            } catch (error) {
                console.error('Error reading file:', error);
            }
        };

        void pollOnce();
        intervalId = window.setInterval(() => {
            void pollOnce();
        }, 1000);

        return () => {
            if (intervalId !== null) {
                window.clearInterval(intervalId);
            }
        };
    }, [
        analyticsSessionId,
        anomalyIsRunning,
        autoRefresh,
        buildLineIndex,
        content,
        dbLineCount,
        dispatch,
        isLargeFile,
        isRemoteLargeSession,
        requestRangeLoad,
        isDbView,
        isStreamView,
        viewMode,
        refreshLastDbLineCache,
    ]);

    const handleToggleAutoRefresh = () => {
        setAutoRefresh((prev) => !prev);
    };

    const handleManualRefresh = async () => {
        if (isLargeFile) return;

        const fileHandle = getFileHandle();
        if (!fileHandle && !isStreamView) return;

        try {
            if (isStreamView) {
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
            lastSizeRef.current = file.size;
            const newContent = await file.slice(0, Math.min(file.size, PREVIEW_BYTES)).text();

            if (isDbView && analyticsSessionId) {
                const previousDbLineCount = dbLineCount;
                const appendResult = await appendLogFileToIndex(file, analyticsSessionId);
                if (appendResult) {
                    setDbLineCount(appendResult.newLineCount);

                    if (appendResult.addedLines <= 0 && (appendResult.newLineCount > 0 || previousDbLineCount > 0)) {
                        const lastLineCount = appendResult.newLineCount > 0 ? appendResult.newLineCount : previousDbLineCount;
                        void refreshLastDbLineCache(lastLineCount);
                    }
                }
            }

            dispatch(updateLogContent({
                content: isDbView ? '' : newContent,
                lastModified: file.lastModified,
                size: file.size,
            }));

        } catch (error) {
            console.error('Error refreshing file:', error);
        }
    };

    const fileSelection = {
        show: !isMonitoring && !loaded,
        indexing,
        onFileSelect: handleFileSystemAccess,
        onFileInputChange: handleFileInputChange,
    };

    const monitoringBanner = {
        show: isDbView && !hasFileHandle && !isRemoteLargeSession,
        message: t('viewLogs.monitoringBanner.message'),
        actionLabel: t('viewLogs.monitoringBanner.actionLabel'),
        onAction: () => void handleReattachMonitoring(),
    };

    const tableServerConnectionState = {
        show: isRemoteLargeSession && isRemoteServerDisconnected,
        message: t('viewLogs.server.reconnecting'),
    };

    const refreshDisabledReason = monitoringBanner.show
        ? t('viewLogs.refreshDisabledReason.monitoringRequired')
        : '';

    const histogram = {
        isLargeFile,
        isIndexing,
        isHistogramLoading,
        parsedLines: isStreamView ? [] : indexedHistogramLines,
        anomalyRegions,
        onAnomalyRangeSelect: handleAnomalyRangeSelect,
        onTimeRangeChange: handleHistogramTimeRangeChange,
        selectedTimeRange: selectedHistogramTimeRange,
    };

    const isTailLoadedMode = (
        isStreamView
        && viewMode === ViewModeEnum.FromEnd
        && lineCount === 0
        && tailLoadedRows.length > 0
    );

    const collectSearchSourceRows = useCallback((): Array<{ lineNumber: number; raw: string }> => {
        if (isTailLoadedMode) {
            return tailLoadedRows.map((row) => ({
                lineNumber: row.sourceLineNumber ?? row.displayLineNumber,
                raw: row.raw,
            }));
        }

        if (isDbView && hasActiveFiltersApplied) {
            return indexedFilteredRows.map((row) => ({
                lineNumber: row.lineNumber,
                raw: row.raw,
            }));
        }

        if (!isStreamView && !isDbView) {
            return displayLines.map((row) => ({
                lineNumber: row.sourceLineNumber ?? row.displayLineNumber,
                raw: row.raw,
            }));
        }

        if (isStreamView) {
            const rows: Array<{ lineNumber: number; raw: string }> = [];
            for (const [fileIndex, entry] of lineCacheRef.current.entries()) {
                rows.push({
                    lineNumber: fileIndex + 1,
                    raw: entry.text,
                });
            }
            return rows;
        }

        if (isDbView && !hasActiveFiltersApplied) {
            const rows: Array<{ lineNumber: number; raw: string }> = [];
            for (const [fileIndex, entry] of dbLineCacheRef.current.entries()) {
                rows.push({
                    lineNumber: fileIndex + 1,
                    raw: entry.text,
                });
            }
            return rows;
        }

        return [];
    }, [
        isTailLoadedMode,
        tailLoadedRows,
        isDbView,
        hasActiveFiltersApplied,
        indexedFilteredRows,
        isStreamView,
        displayLines,
        lineCacheVersion,
        dbLineCacheVersion,
    ]);

    const collectSearchMatchLines = useCallback((term: string): number[] => {
        const normalizedTerm = term.toLowerCase().trim();
        if (!normalizedTerm) {
            return [];
        }

        const rows = collectSearchSourceRows();
        if (rows.length === 0) {
            return [];
        }

        const matched = rows
            .filter((row) => row.raw.toLowerCase().includes(normalizedTerm))
            .map((row) => row.lineNumber)
            .filter((lineNumber) => Number.isFinite(lineNumber) && lineNumber > 0);

        if (matched.length === 0) {
            return [];
        }

        return Array.from(new Set(matched)).sort((a, b) => a - b);
    }, [collectSearchSourceRows]);

    const getAdjacentSearchMatchLine = useCallback((
        direction: 'up' | 'down',
        fromLine: number | null,
        term: string = searchTerm,
    ): number | null => {
        const matchLines = collectSearchMatchLines(term);
        if (matchLines.length === 0) {
            return null;
        }

        const minLine = matchLines[0];
        const maxLine = matchLines[matchLines.length - 1];

        const moveTowardsGreaterLine = direction === 'down'
            ? viewMode !== ViewModeEnum.FromEnd
            : viewMode === ViewModeEnum.FromEnd;

        const normalizedCurrent = fromLine !== null && Number.isFinite(fromLine)
            ? Math.floor(fromLine)
            : null;

        if (!normalizedCurrent || normalizedCurrent <= 0) {
            return moveTowardsGreaterLine ? minLine : maxLine;
        }

        if (moveTowardsGreaterLine) {
            for (let i = 0; i < matchLines.length; i += 1) {
                const line = matchLines[i];
                if (normalizedCurrent < line) {
                    return line;
                }
            }
            return minLine;
        }

        for (let i = matchLines.length - 1; i >= 0; i -= 1) {
            const line = matchLines[i];
            if (normalizedCurrent > line) {
                return line;
            }
        }

        return maxLine;
    }, [collectSearchMatchLines, searchTerm, viewMode]);

    const resolveIndexedDirection = useCallback((direction: 'up' | 'down'): 'next' | 'previous' => {
        const moveTowardsGreaterLine = direction === 'down'
            ? viewMode !== ViewModeEnum.FromEnd
            : viewMode === ViewModeEnum.FromEnd;

        return moveTowardsGreaterLine ? 'next' : 'previous';
    }, [viewMode]);

    const readStreamLinesRange = useCallback(async (
        file: File,
        startLine: number,
        endLine: number,
    ): Promise<Array<{ lineNumber: number; raw: string }>> => {
        const offsets = lineOffsetsRef.current;
        if (offsets.length === 0 || endLine < startLine) {
            return [];
        }

        const safeStartLine = Math.max(1, startLine);
        const safeEndLine = Math.min(endLine, offsets.length);
        if (safeEndLine < safeStartLine) {
            return [];
        }

        const startIndex = safeStartLine - 1;
        const endIndex = safeEndLine - 1;

        const startOffset = getOffsetAt(offsets, startIndex);
        const endOffset = endIndex + 1 < offsets.length
            ? getOffsetAt(offsets, endIndex + 1)
            : file.size;

        const buffer = await file.slice(startOffset, endOffset).arrayBuffer();
        const text = new TextDecoder('utf-8').decode(buffer);
        const lines = text.split(/\r?\n/);

        const expectedCount = safeEndLine - safeStartLine + 1;
        if (lines.length > expectedCount) {
            lines.length = expectedCount;
        }

        const result: Array<{ lineNumber: number; raw: string }> = [];
        for (let i = 0; i < lines.length; i += 1) {
            result.push({
                lineNumber: safeStartLine + i,
                raw: lines[i],
            });
        }

        return result;
    }, []);

    const findAdjacentStreamLineMatch = useCallback(async (
        term: string,
        options: {
            fromLine?: number | null;
            direction?: 'next' | 'previous';
            wrap?: boolean;
        } = {},
    ): Promise<number | null> => {
        const normalizedTerm = term.toLowerCase().trim();
        if (!normalizedTerm || lineCount <= 0) {
            return null;
        }

        const file = await getActiveFile();
        if (!file) {
            return null;
        }

        const direction = options.direction ?? 'next';
        const wrap = options.wrap ?? true;
        const normalizedFromLine = (
            options.fromLine !== undefined
            && options.fromLine !== null
            && Number.isFinite(options.fromLine)
        )
            ? Math.max(1, Math.min(lineCount, Math.floor(options.fromLine)))
            : null;

        const scanRange = async (startLine: number, endLine: number, scanDirection: 'next' | 'previous'): Promise<number | null> => {
            if (endLine < startLine) {
                return null;
            }

            if (scanDirection === 'next') {
                for (let chunkStart = startLine; chunkStart <= endLine; chunkStart += SEARCH_SCAN_CHUNK_LINES) {
                    const chunkEnd = Math.min(endLine, chunkStart + SEARCH_SCAN_CHUNK_LINES - 1);
                    const rows = await readStreamLinesRange(file, chunkStart, chunkEnd);
                    for (let i = 0; i < rows.length; i += 1) {
                        if (rows[i].raw.toLowerCase().includes(normalizedTerm)) {
                            return rows[i].lineNumber;
                        }
                    }
                }
                return null;
            }

            for (let chunkEnd = endLine; chunkEnd >= startLine; chunkEnd -= SEARCH_SCAN_CHUNK_LINES) {
                const chunkStart = Math.max(startLine, chunkEnd - SEARCH_SCAN_CHUNK_LINES + 1);
                const rows = await readStreamLinesRange(file, chunkStart, chunkEnd);
                for (let i = rows.length - 1; i >= 0; i -= 1) {
                    if (rows[i].raw.toLowerCase().includes(normalizedTerm)) {
                        return rows[i].lineNumber;
                    }
                }
            }

            return null;
        };

        if (direction === 'next') {
            if (normalizedFromLine !== null) {
                const foundForward = await scanRange(normalizedFromLine + 1, lineCount, 'next');
                if (foundForward !== null) {
                    return foundForward;
                }

                if (wrap) {
                    return await scanRange(1, normalizedFromLine, 'next');
                }

                return null;
            }

            return await scanRange(1, lineCount, 'next');
        }

        if (normalizedFromLine !== null) {
            const foundBackward = await scanRange(1, normalizedFromLine - 1, 'previous');
            if (foundBackward !== null) {
                return foundBackward;
            }

            if (wrap) {
                return await scanRange(normalizedFromLine + 1, lineCount, 'previous');
            }

            return null;
        }

        return await scanRange(1, lineCount, 'previous');
    }, [getActiveFile, lineCount, readStreamLinesRange]);

    const findAdjacentSearchMatchLine = useCallback(async (
        direction: 'up' | 'down',
        fromLine: number | null,
        term: string = searchTerm,
    ): Promise<number | null> => {
        const normalizedTerm = term.trim();
        if (!normalizedTerm) {
            return null;
        }

        const canUseIndexedLookup = (
            isDbView
            && !hasActiveFiltersApplied
            && Boolean(analyticsSessionId)
        );

        if (canUseIndexedLookup && analyticsSessionId) {
            return await findAdjacentLineMatch(analyticsSessionId, normalizedTerm, {
                fromLine,
                direction: resolveIndexedDirection(direction),
                wrap: true,
            });
        }

        if (isStreamView) {
            return await findAdjacentStreamLineMatch(normalizedTerm, {
                fromLine,
                direction: resolveIndexedDirection(direction),
                wrap: true,
            });
        }

        return getAdjacentSearchMatchLine(direction, fromLine, term);
    }, [
        analyticsSessionId,
        findAdjacentStreamLineMatch,
        getAdjacentSearchMatchLine,
        hasActiveFiltersApplied,
        isDbView,
        isStreamView,
        resolveIndexedDirection,
        searchTerm,
    ]);

    const nextSearchMatchTargetLine = useMemo<number | null>(() => {
        return getAdjacentSearchMatchLine('down', selectedLine);
    }, [getAdjacentSearchMatchLine, selectedLine]);

    const previousSearchMatchTargetLine = useMemo<number | null>(() => {
        return getAdjacentSearchMatchLine('up', selectedLine);
    }, [getAdjacentSearchMatchLine, selectedLine]);

    const submitSearch = useCallback(async (term: string): Promise<boolean> => {
        const normalizedTerm = term.trim();
        if (!normalizedTerm) {
            setSearchTerm(term);
            return false;
        }

        const targetLine = await findAdjacentSearchMatchLine('down', null, term);
        setSearchTerm(term);

        if (targetLine === null) {
            return false;
        }

        handleAnomalyRangeSelect(targetLine, targetLine);
        return true;
    }, [findAdjacentSearchMatchLine, handleAnomalyRangeSelect]);

    const navigateToNextSearchMatch = useCallback(() => {
        void (async () => {
            const targetLine = await findAdjacentSearchMatchLine('down', selectedLine);
            if (targetLine === null) {
                return;
            }

            handleAnomalyRangeSelect(targetLine, targetLine);
        })();
    }, [findAdjacentSearchMatchLine, handleAnomalyRangeSelect, selectedLine]);

    const navigateToPreviousSearchMatch = useCallback(() => {
        void (async () => {
            const targetLine = await findAdjacentSearchMatchLine('up', selectedLine);
            if (targetLine === null) {
                return;
            }

            handleAnomalyRangeSelect(targetLine, targetLine);
        })();
    }, [findAdjacentSearchMatchLine, handleAnomalyRangeSelect, selectedLine]);

    const hasSearchTerm = searchTerm.trim().length > 0;
    const canUseFullSourceSearchNavigation = (
        hasSearchTerm
        && (
            (isStreamView && lineCount > 0)
            || (isDbView && !hasActiveFiltersApplied && dbLineCount > 0)
        )
    );

    const toolbarProps = {
        onManualRefresh: handleManualRefresh,
        autoRefresh,
        onToggleAutoRefresh: handleToggleAutoRefresh,
        onUploadToServer: requiresServerUpload && !uploadDisabledReason ? () => void handleUploadToServer() : undefined,
        viewMode,
        onViewModeChange: setViewMode,
        searchTerm,
        onSearchTermChange: setSearchTerm,
        onSearchSubmit: submitSearch,
        onNavigateToPreviousSearchMatch: navigateToPreviousSearchMatch,
        canNavigateToPreviousSearchMatch: (
            previousSearchMatchTargetLine !== null
            || canUseFullSourceSearchNavigation
        ),
        onNavigateToNextSearchMatch: navigateToNextSearchMatch,
        canNavigateToNextSearchMatch: (
            nextSearchMatchTargetLine !== null
            || canUseFullSourceSearchNavigation
        ),
        filters,
        onFiltersChange: setFilters,
        fieldDefinitions,
        hasAnomalyResults,
        isLargeFile,
        isStreamView,
        filtersDisabled: isIndexing || serverUploadInProgress,
        totalRowsHintForAnomaly,
        normalRows,
        requestFileForAnomalyAnalysis,
        anomalyStorageKey,
        onNavigateToPreviousAnomaly: () => navigateToAdjacentAnomaly('up'),
        onNavigateToNextAnomaly: () => navigateToAdjacentAnomaly('down'),
        canNavigateToPreviousAnomaly: previousAnomalyTargetLine !== null,
        canNavigateToNextAnomaly: nextAnomalyTargetLine !== null,
        remoteIngestId: isRemoteLargeSession ? analyticsSessionId.replace('remote:', '') : undefined,
        showUploadToServer: requiresServerUpload,
        uploadInProgress: isServerUploadActive,
        uploadProgress: isServerUploadActive
            ? (serverUploadInProgress ? serverUploadProgress : indexingProgress)
            : 0,
        fileActionsDisabled: requiresServerUpload,
        uploadDisabledReason,
        refreshDisabledReason,
    };

    let totalCount = displayLines.length;
    if (isTailLoadedMode) {
        totalCount = tailLoadedRows.length;
    } else if (isStreamView) {
        totalCount = getVirtualWindowSize(virtualWindowStart, lineCount);
    } else if (isDbView && hasActiveFiltersApplied) {
        totalCount = indexedFilteredRows.length;
    } else if (isDbView) {
        totalCount = getVirtualWindowSize(dbVirtualWindowStart, dbLineCount);
    }

    const showEmptyFilteredState = hasActiveFiltersApplied
        && !isStreamView
        && !isFilteringRows
        && totalCount === 0;

    const listProps = {
        displayLines: isTailLoadedMode ? tailLoadedRows : displayLines,
        totalCount,
        getLineAtIndex: isTailLoadedMode ? undefined : getLineAtIndex,
        onRangeChange: isTailLoadedMode
            ? undefined
            : (isStreamView
                ? handleRangeChange
                : (isDbView
                    ? (hasActiveFiltersApplied
                        ? handleRemoteFilteredRangeChange
                        : handleDbRangeChange)
                    : undefined)),
        globalSearchTerm: searchTerm,
        selectedLine,
        onSelectLine: setSelectedLine,
        virtuosoRef,
    };

    return {
        fileSelection,
        monitoringBanner,
        tableServerConnectionState,
        isTableFilteringRows: isFilteringRows,
        histogram,
        toolbarProps,
        listProps,
        showEmptyFilteredState,
        formatChangeDialog: {
            open: formatChangeDialogState.open,
            message: formatChangeDialogState.message,
            onConfirm: handleFormatChangeDialogConfirm,
            onCancel: handleFormatChangeDialogCancel,
        },
        monitoringReplaceDialog: {
            open: monitoringReplaceDialogState.open,
            message: monitoringReplaceDialogState.message,
            onConfirm: handleMonitoringReplaceConfirm,
            onCancel: handleMonitoringReplaceCancel,
        },
        confirmDialog: {
            open: confirmDialogState.open,
            fileName: confirmDialogState.fileName,
            fileSize: confirmDialogState.fileSize,
            previewText: confirmDialogState.previewText,
            onConfirm: handleConfirmDialogConfirm,
            onCancel: handleConfirmDialogCancel,
        },
        customFormatDialog: {
            open: customFormatDialogState.open,
            previewLines: customFormatDialogState.previewLines,
            fileName: customFormatDialogState.fileName,
            onClose: closeUnknownFormatDialog,
            onSubmit: handleCreateCustomFormatForUnknown,
        },
        isRemoteLargeSession,
        isDbView,
        requiresServerUpload,
    };
};
