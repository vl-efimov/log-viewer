import { createSlice, PayloadAction } from '@reduxjs/toolkit';
// Global storage for FileSystemFileHandle and File (can't be serialized in Redux)
let globalFileHandle: FileSystemFileHandle | null = null;
let globalFileObject: File | null = null;

export const setFileHandle = (handle: FileSystemFileHandle | null) => {
    globalFileHandle = handle;
};

export const getFileHandle = (): FileSystemFileHandle | null => {
    return globalFileHandle;
};

export const setFileObject = (file: File | null) => {
    globalFileObject = file;
};

export const getFileObject = (): File | null => {
    return globalFileObject;
};


interface LogFileState {
    name: string;
    size: number;
    content: string;
    format: string;
    analyticsSessionId: string;
    loaded: boolean;
    lastModified: number;
    hasFileHandle: boolean; // Flag indicating if we have a File System Access API handle
    isMonitoring: boolean; // Flag for live monitoring state
    isLargeFile: boolean; // Flag for chunked loading mode
    anomalyRegions: Array<{
        start_index: number;
        end_index: number;
        start_line: number;
        end_line: number;
        count: number;
        start_timestamp: string | null;
        end_timestamp: string | null;
    }>;
    anomalyLineNumbers: number[];
    hasAnomalyResults: boolean;
    anomalyRowsCount: number;
    anomalyError: string;
    anomalyLastAnalyzedAt: number | null;
    anomalyLastModelId: 'bgl' | 'hdfs' | null;
    anomalyIsRunning: boolean;
    anomalyRunStartedAt: number | null;
    anomalyExpectedDurationSec: number | null;
    anomalyLastDurationSec: number | null;
    anomalyRowsPerSecondByModel: {
        bgl: number | null;
        hdfs: number | null;
    };
    anomalyLastRunParams: {
        threshold: number;
        stepSize: number;
        minRegionLines: number;
        analysisScope: 'all' | 'filtered';
        timestampColumn: 'auto' | 'timestamp' | 'datetime' | 'time' | 'date' | 'event_time' | 'created_at';
    } | null;
}

const initialState: LogFileState = {
    name: '',
    size: 0,
    content: '',
    format: '',
    analyticsSessionId: '',
    loaded: false,
    lastModified: 0,
    hasFileHandle: false,
    isMonitoring: false,
    isLargeFile: false,
    anomalyRegions: [],
    anomalyLineNumbers: [],
    hasAnomalyResults: false,
    anomalyRowsCount: 0,
    anomalyError: '',
    anomalyLastAnalyzedAt: null,
    anomalyLastModelId: null,
    anomalyIsRunning: false,
    anomalyRunStartedAt: null,
    anomalyExpectedDurationSec: null,
    anomalyLastDurationSec: null,
    anomalyRowsPerSecondByModel: {
        bgl: null,
        hdfs: null,
    },
    anomalyLastRunParams: null,
};

const logFileSlice = createSlice({
    name: 'logFile',
    initialState,
    reducers: {
        setLogFile: (state, action: PayloadAction<{
            name: string;
            size: number;
            content: string;
            format: string;
            lastModified?: number;
            hasFileHandle?: boolean;
            isLargeFile?: boolean;
        }>) => {
            state.name = action.payload.name;
            state.size = action.payload.size;
            state.content = action.payload.content;
            state.format = action.payload.format;
            state.analyticsSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            state.lastModified = action.payload.lastModified || Date.now();
            state.hasFileHandle = action.payload.hasFileHandle || false;
            state.isLargeFile = action.payload.isLargeFile || false;
            state.anomalyRegions = [];
            state.anomalyLineNumbers = [];
            state.hasAnomalyResults = false;
            state.anomalyRowsCount = 0;
            state.anomalyError = '';
            state.anomalyLastAnalyzedAt = null;
            state.anomalyLastModelId = null;
            state.anomalyIsRunning = false;
            state.anomalyRunStartedAt = null;
            state.anomalyExpectedDurationSec = null;
            state.anomalyLastDurationSec = null;
            state.anomalyLastRunParams = null;
            state.loaded = true;
        },
        updateLogContent: (state, action: PayloadAction<{ content: string; lastModified?: number }>) => {
            if (!state.isLargeFile) {
                state.content = action.payload.content;
            }
            state.lastModified = action.payload.lastModified || Date.now();
            state.anomalyRegions = [];
            state.anomalyLineNumbers = [];
            state.hasAnomalyResults = false;
            state.anomalyRowsCount = 0;
            state.anomalyError = '';
            state.anomalyLastAnalyzedAt = null;
            state.anomalyLastModelId = null;
            state.anomalyIsRunning = false;
            state.anomalyRunStartedAt = null;
            state.anomalyExpectedDurationSec = null;
            state.anomalyLastDurationSec = null;
            state.anomalyLastRunParams = null;
        },
        appendLogContent: (state, action: PayloadAction<{ newContent: string; newSize: number; lastModified?: number }>) => {
            if (!state.isLargeFile) {
                state.content = state.content + action.payload.newContent;
            }
            state.size = action.payload.newSize;
            state.lastModified = action.payload.lastModified || Date.now();
            state.anomalyRegions = [];
            state.anomalyLineNumbers = [];
            state.hasAnomalyResults = false;
            state.anomalyRowsCount = 0;
            state.anomalyError = '';
            state.anomalyLastAnalyzedAt = null;
            state.anomalyLastModelId = null;
            state.anomalyIsRunning = false;
            state.anomalyRunStartedAt = null;
            state.anomalyExpectedDurationSec = null;
            state.anomalyLastDurationSec = null;
            state.anomalyLastRunParams = null;
        },
        setAnomalyResults: (state, action: PayloadAction<{
            regions: LogFileState['anomalyRegions'];
            lineNumbers: number[];
            rowsCount: number;
            analyzedAt: number;
            modelId: 'bgl' | 'hdfs';
            params: NonNullable<LogFileState['anomalyLastRunParams']>;
        }>) => {
            state.anomalyRegions = action.payload.regions;
            state.anomalyLineNumbers = action.payload.lineNumbers;
            state.hasAnomalyResults = true;
            state.anomalyRowsCount = action.payload.rowsCount;
            state.anomalyError = '';
            state.anomalyLastAnalyzedAt = action.payload.analyzedAt;
            state.anomalyLastModelId = action.payload.modelId;
            state.anomalyLastRunParams = action.payload.params;
        },
        setAnomalyError: (state, action: PayloadAction<string>) => {
            state.anomalyError = action.payload;
        },
        setAnomalyRunning: (state, action: PayloadAction<{
            running: boolean;
            startedAt?: number | null;
            expectedDurationSec?: number | null;
        }>) => {
            state.anomalyIsRunning = action.payload.running;
            if (action.payload.startedAt !== undefined) {
                state.anomalyRunStartedAt = action.payload.startedAt;
            }
            if (action.payload.expectedDurationSec !== undefined) {
                state.anomalyExpectedDurationSec = action.payload.expectedDurationSec;
            }
            if (!action.payload.running) {
                state.anomalyRunStartedAt = null;
                state.anomalyExpectedDurationSec = null;
            }
        },
        setAnomalyLastDurationSec: (state, action: PayloadAction<number | null>) => {
            state.anomalyLastDurationSec = action.payload;
        },
        updateAnomalyRowsPerSecond: (state, action: PayloadAction<{ modelId: 'bgl' | 'hdfs'; rowsPerSecond: number }>) => {
            const { modelId, rowsPerSecond } = action.payload;
            const prev = state.anomalyRowsPerSecondByModel[modelId];
            // EMA to smooth noisy run-to-run durations.
            state.anomalyRowsPerSecondByModel[modelId] = prev == null
                ? rowsPerSecond
                : (prev * 0.6 + rowsPerSecond * 0.4);
        },
        clearAnomalyResults: (state) => {
            state.anomalyRegions = [];
            state.anomalyLineNumbers = [];
            state.hasAnomalyResults = false;
            state.anomalyRowsCount = 0;
            state.anomalyError = '';
            state.anomalyLastAnalyzedAt = null;
            state.anomalyLastModelId = null;
            state.anomalyIsRunning = false;
            state.anomalyRunStartedAt = null;
            state.anomalyExpectedDurationSec = null;
            state.anomalyLastDurationSec = null;
            state.anomalyLastRunParams = null;
        },
        setMonitoringState: (state, action: PayloadAction<boolean>) => {
            state.isMonitoring = action.payload;
        },
        clearLogFile: (state) => {
            state.name = '';
            state.size = 0;
            state.content = '';
            state.format = '';
            state.analyticsSessionId = '';
            state.loaded = false;
            state.lastModified = 0;
            state.hasFileHandle = false;
            state.isMonitoring = false;
            state.isLargeFile = false;
            state.anomalyRegions = [];
            state.anomalyLineNumbers = [];
            state.hasAnomalyResults = false;
            state.anomalyRowsCount = 0;
            state.anomalyError = '';
            state.anomalyLastAnalyzedAt = null;
            state.anomalyLastModelId = null;
            state.anomalyIsRunning = false;
            state.anomalyRunStartedAt = null;
            state.anomalyExpectedDurationSec = null;
            state.anomalyLastDurationSec = null;
            state.anomalyLastRunParams = null;
        },
    },
});

export const {
    setLogFile,
    updateLogContent,
    appendLogContent,
    setAnomalyResults,
    setAnomalyError,
    setAnomalyRunning,
    setAnomalyLastDurationSec,
    updateAnomalyRowsPerSecond,
    clearAnomalyResults,
    setMonitoringState,
    clearLogFile,
} = logFileSlice.actions;
export default logFileSlice.reducer;
