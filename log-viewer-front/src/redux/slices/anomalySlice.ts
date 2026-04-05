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
    error: string;
    lastAnalyzedAt: number | null;
    lastModelId: 'bgl' | 'hdfs' | null;
    isRunning: boolean;
    runStartedAt: number | null;
    expectedDurationSec: number | null;
    lastDurationSec: number | null;
    rowsPerSecondByModel: {
        bgl: number | null;
        hdfs: number | null;
    };
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
    error: '',
    lastAnalyzedAt: null,
    lastModelId: null,
    isRunning: false,
    runStartedAt: null,
    expectedDurationSec: null,
    lastDurationSec: null,
    rowsPerSecondByModel: {
        bgl: null,
        hdfs: null,
    },
    lastRunParams: null,
};

const anomalySlice = createSlice({
    name: 'anomaly',
    initialState: initialAnomalyState,
    reducers: {
        setAnomalyResults: (state, action: PayloadAction<{
            regions: AnomalyState['regions'];
            lineNumbers: number[];
            rowsCount: number;
            analyzedAt: number;
            modelId: 'bgl' | 'hdfs';
            params: NonNullable<AnomalyState['lastRunParams']>;
        }>) => {
            state.regions = action.payload.regions;
            state.lineNumbers = action.payload.lineNumbers;
            state.hasResults = true;
            state.rowsCount = action.payload.rowsCount;
            state.error = '';
            state.lastAnalyzedAt = action.payload.analyzedAt;
            state.lastModelId = action.payload.modelId;
            state.lastRunParams = action.payload.params;
        },
        setAnomalyError: (state, action: PayloadAction<string>) => {
            state.error = action.payload;
        },
        setAnomalyRunning: (state, action: PayloadAction<{
            running: boolean;
            startedAt?: number | null;
            expectedDurationSec?: number | null;
        }>) => {
            state.isRunning = action.payload.running;
            if (action.payload.startedAt !== undefined) {
                state.runStartedAt = action.payload.startedAt;
            }
            if (action.payload.expectedDurationSec !== undefined) {
                state.expectedDurationSec = action.payload.expectedDurationSec;
            }
            if (!action.payload.running) {
                state.runStartedAt = null;
                state.expectedDurationSec = null;
            }
        },
        setAnomalyLastDurationSec: (state, action: PayloadAction<number | null>) => {
            state.lastDurationSec = action.payload;
        },
        updateAnomalyRowsPerSecond: (state, action: PayloadAction<{ modelId: 'bgl' | 'hdfs'; rowsPerSecond: number }>) => {
            const { modelId, rowsPerSecond } = action.payload;
            const prev = state.rowsPerSecondByModel[modelId];
            // EMA to smooth noisy run-to-run durations.
            state.rowsPerSecondByModel[modelId] = prev == null
                ? rowsPerSecond
                : (prev * 0.6 + rowsPerSecond * 0.4);
        },
        clearAnomalyResults: (state) => {
            state.regions = [];
            state.lineNumbers = [];
            state.hasResults = false;
            state.rowsCount = 0;
            state.error = '';
            state.lastAnalyzedAt = null;
            state.lastModelId = null;
            state.isRunning = false;
            state.runStartedAt = null;
            state.expectedDurationSec = null;
            state.lastDurationSec = null;
            state.lastRunParams = null;
        },
    },
});

export const {
    setAnomalyResults,
    setAnomalyError,
    setAnomalyRunning,
    setAnomalyLastDurationSec,
    updateAnomalyRowsPerSecond,
    clearAnomalyResults,
} = anomalySlice.actions;

export default anomalySlice.reducer;
