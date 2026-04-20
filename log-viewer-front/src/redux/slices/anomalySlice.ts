import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AnomalyState {
    regions: Array<{
        start_index: number;
        end_index: number;
        start_line: number;
        end_line: number;
        count: number;
        start_timestamp: string | null;
        end_timestamp: string | null;
    }>;
    lineNumbers: number[];
    hasResults: boolean;
    rowsCount: number;
    totalRows: number;
    error: string;
    isStopped: boolean;
    stoppedAt: number | null;
    lastAnalyzedAt: number | null;
    lastModelId: 'bgl' | 'hdfs' | null;
    isRunning: boolean;
    runningModelId: 'bgl' | 'hdfs' | null;
    cancelRequestSeq: number;
    lastRunParams: {
        threshold: number;
        stepSize: number;
        minRegionLines: number;
        analysisScope: 'all' | 'filtered';
        timestampColumn: 'auto' | 'timestamp' | 'datetime' | 'time' | 'date' | 'event_time' | 'created_at';
    } | null;
}

const initialAnomalyState: AnomalyState = {
    regions: [],
    lineNumbers: [],
    hasResults: false,
    rowsCount: 0,
    totalRows: 0,
    error: '',
    isStopped: false,
    stoppedAt: null,
    lastAnalyzedAt: null,
    lastModelId: null,
    isRunning: false,
    runningModelId: null,
    cancelRequestSeq: 0,
    lastRunParams: null,
};

const anomalySlice = createSlice({
    name: 'anomaly',
    initialState: initialAnomalyState,
    reducers: {
        setAnomalyResults: (state, action: PayloadAction<{
            regions: AnomalyState['regions'];
            lineNumbers?: number[];
            rowsCount: number;
            totalRows: number;
            analyzedAt: number;
            modelId: 'bgl' | 'hdfs';
            params: NonNullable<AnomalyState['lastRunParams']>;
        }>) => {
            state.regions = action.payload.regions;
            state.lineNumbers = action.payload.lineNumbers ?? [];
            state.hasResults = true;
            state.rowsCount = action.payload.rowsCount;
            state.totalRows = action.payload.totalRows;
            state.error = '';
            state.isStopped = false;
            state.stoppedAt = null;
            state.lastAnalyzedAt = action.payload.analyzedAt;
            state.lastModelId = action.payload.modelId;
            state.lastRunParams = action.payload.params;
        },
        setAnomalyError: (state, action: PayloadAction<string>) => {
            state.error = action.payload;
            state.isStopped = false;
            state.stoppedAt = null;
        },
        setAnomalyStopped: (state) => {
            state.error = '';
            state.isStopped = true;
            state.stoppedAt = Date.now();
        },
        requestAnomalyCancel: (state) => {
            state.cancelRequestSeq += 1;
        },
        setAnomalyRunning: (state, action: PayloadAction<{
            running: boolean;
            modelId?: 'bgl' | 'hdfs' | null;
        }>) => {
            state.isRunning = action.payload.running;
            if (action.payload.modelId !== undefined) {
                state.runningModelId = action.payload.modelId;
            }
            if (!action.payload.running) {
                state.runningModelId = null;
            }
        },
        clearAnomalyResults: (state) => {
            state.regions = [];
            state.lineNumbers = [];
            state.hasResults = false;
            state.rowsCount = 0;
            state.totalRows = 0;
            state.error = '';
            state.isStopped = false;
            state.stoppedAt = null;
            state.lastAnalyzedAt = null;
            state.lastModelId = null;
            state.isRunning = false;
            state.runningModelId = null;
            state.lastRunParams = null;
        },
    },
});

export const {
    setAnomalyResults,
    setAnomalyError,
    setAnomalyStopped,
    requestAnomalyCancel,
    setAnomalyRunning,
    clearAnomalyResults,
} = anomalySlice.actions;

export default anomalySlice.reducer;
