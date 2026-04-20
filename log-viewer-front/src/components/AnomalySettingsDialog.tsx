import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MemoryIcon from '@mui/icons-material/Memory';
import StorageIcon from '@mui/icons-material/Storage';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../redux/store';
import {
    clearAnomalyResults,
    setAnomalyError,
    setAnomalyResults,
    setAnomalyRunning,
    setAnomalyStopped,
    updateAnomalyRowsPerSecond,
} from '../redux/slices/anomalySlice';
import { deleteAnomalySnapshot } from '../utils/logIndexedDb';
import {
    beginAnomalyPredictionSession,
    endAnomalyPredictionSession,
    getPretrainedModels,
    predictBglAnomaliesFromFile,
    predictBglAnomaliesFromIngest,
} from '../services/bglAnomalyApi';
import {
    ANOMALY_MIN_REGION_LINES_RANGE,
    ANOMALY_SETTINGS_DEFAULTS,
    ANOMALY_STEP_SIZE_RANGE,
    ANOMALY_THRESHOLD_RANGE,
    type AnomalySettings,
    loadAnomalySettings,
    loadSelectedAnomalyModelId,
    saveAnomalySettings,
    saveSelectedAnomalyModelId,
} from '../utils/anomalySettings';

type AnomalySourceRow = {
    lineNumber: number;
    raw: string;
};

type AnomalyEtaHistorySample = {
    modelId: 'bgl' | 'hdfs';
    rows: number;
    bytes: number | null;
    durationSec: number;
    createdAt: number;
};

const ANOMALY_ETA_HISTORY_STORAGE_KEY = 'logViewer.anomalyEtaHistory.v1';
const ANOMALY_ETA_HISTORY_MAX_SAMPLES = 120;
const ANOMALY_ETA_MAX_REASONABLE_DURATION_SEC = 7 * 24 * 60 * 60;

function normalizeHistoryDurationSec(value: unknown): number | null {
    const raw = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(raw) || raw <= 0) {
        return null;
    }

    if (raw <= ANOMALY_ETA_MAX_REASONABLE_DURATION_SEC) {
        return raw;
    }

    // Backward compatibility: older versions could persist milliseconds in durationSec.
    const maybeSeconds = raw / 1000;
    if (maybeSeconds >= 1 && maybeSeconds <= ANOMALY_ETA_MAX_REASONABLE_DURATION_SEC) {
        return maybeSeconds;
    }

    return null;
}

function loadAnomalyEtaHistory(): AnomalyEtaHistorySample[] {
    if (typeof window === 'undefined') {
        return [];
    }

    try {
        const raw = window.localStorage.getItem(ANOMALY_ETA_HISTORY_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.flatMap((sample): AnomalyEtaHistorySample[] => {
            if (!sample || (sample.modelId !== 'bgl' && sample.modelId !== 'hdfs')) {
                return [];
            }

            const rows = typeof sample.rows === 'number' ? sample.rows : Number(sample.rows);
            if (!Number.isFinite(rows) || rows <= 0) {
                return [];
            }

            const durationSec = normalizeHistoryDurationSec(sample.durationSec);
            if (durationSec == null) {
                return [];
            }

            const createdAt = typeof sample.createdAt === 'number' ? sample.createdAt : Number(sample.createdAt);
            if (!Number.isFinite(createdAt)) {
                return [];
            }

            const bytes = sample.bytes === null
                ? null
                : (typeof sample.bytes === 'number' && Number.isFinite(sample.bytes) && sample.bytes >= 0 ? sample.bytes : null);

            return [{
                modelId: sample.modelId,
                rows,
                bytes,
                durationSec,
                createdAt,
            }];
        });
    } catch {
        return [];
    }
}

function saveAnomalyEtaHistory(samples: AnomalyEtaHistorySample[]): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(ANOMALY_ETA_HISTORY_STORAGE_KEY, JSON.stringify(samples));
    } catch {
        // Best-effort cache; ignore quota or serialization errors.
    }
}

function addAnomalyEtaHistorySample(sample: AnomalyEtaHistorySample): void {
    const current = loadAnomalyEtaHistory();
    const next = [...current, sample]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-ANOMALY_ETA_HISTORY_MAX_SAMPLES);
    saveAnomalyEtaHistory(next);
}

function estimateExpectedDurationFromHistory(params: {
    modelId: 'bgl' | 'hdfs';
    rowsToAnalyze: number;
    bytesToAnalyze: number | null;
}): number | null {
    const { modelId, rowsToAnalyze, bytesToAnalyze } = params;
    if (rowsToAnalyze <= 0) {
        return null;
    }

    const history = loadAnomalyEtaHistory()
        .filter((sample) => sample.modelId === modelId);
    if (history.length < 3) {
        return null;
    }

    const currentBytesPerRow = bytesToAnalyze && bytesToAnalyze > 0
        ? bytesToAnalyze / Math.max(1, rowsToAnalyze)
        : null;

    const projectedDurations = history
        .map((sample) => {
            const rowScale = rowsToAnalyze / Math.max(1, sample.rows);
            // Avoid extreme extrapolation from tiny/huge unrelated runs.
            if (rowScale > 25 || rowScale < (1 / 25)) {
                return null;
            }
            const sampleBytesPerRow = sample.bytes && sample.bytes > 0
                ? sample.bytes / Math.max(1, sample.rows)
                : null;
            const complexityScale = currentBytesPerRow && sampleBytesPerRow
                ? Math.max(0.65, Math.min(2.4, currentBytesPerRow / sampleBytesPerRow))
                : 1;
            const recencyDays = Math.max(0, (Date.now() - sample.createdAt) / (24 * 60 * 60 * 1000));
            const recencyScale = recencyDays > 21 ? 1.08 : recencyDays > 7 ? 1.04 : 1;

            const projected = sample.durationSec * rowScale * complexityScale * recencyScale;
            if (!Number.isFinite(projected) || projected <= 0 || projected > ANOMALY_ETA_MAX_REASONABLE_DURATION_SEC) {
                return null;
            }

            return projected;
        })
        .filter((value): value is number => value != null)
        .sort((a, b) => a - b);

    if (projectedDurations.length < 3) {
        return null;
    }

    // Use upper quantile to stay slightly conservative for user-facing ETA.
    const q75Index = Math.floor((projectedDurations.length - 1) * 0.75);
    const q75 = projectedDurations[q75Index];
    return Math.max(1, Math.round(q75 * 1.08));
}

interface AnomalySettingsDialogProps {
    open: boolean;
    onClose: () => void;
    isStreamView: boolean;
    totalRowsHint: number;
    normalRows: AnomalySourceRow[];
    requestFileForAnomalyAnalysis: () => Promise<File | null>;
    remoteIngestId?: string;
    anomalyStorageKey?: string;
}

const AnomalySettingsDialog: React.FC<AnomalySettingsDialogProps> = ({
    open,
    onClose,
    isStreamView,
    totalRowsHint,
    normalRows,
    requestFileForAnomalyAnalysis,
    remoteIngestId,
    anomalyStorageKey,
}) => {
    const dispatch = useDispatch();
    const {
        isMonitoring,
        isIndexing,
        isLargeFile,
        hasFileHandle,
        size: logFileSize,
    } = useSelector((state: RootState) => state.logFile);
    const {
        hasResults: anomalyHasResults,
        isRunning: anomalyIsRunning,
        cancelRequestSeq,
        rowsPerSecondByModel: anomalyRowsPerSecondByModel,
    } = useSelector((state: RootState) => state.anomaly);
    const [selectedModelId, setSelectedModelId] = useState<'bgl' | 'hdfs'>(() => loadSelectedAnomalyModelId());
    const [anomalySettings, setAnomalySettings] = useState<AnomalySettings>(() => loadAnomalySettings(loadSelectedAnomalyModelId()));
    const [isModelReady, setIsModelReady] = useState<boolean>(false);
    const [isModelReadyLoading, setIsModelReadyLoading] = useState<boolean>(false);
    const [activeAbortController, setActiveAbortController] = useState<AbortController | null>(null);
    const cancelRequestSeqRef = useRef(cancelRequestSeq);

    useEffect(() => {
        cancelRequestSeqRef.current = cancelRequestSeq;
    }, [cancelRequestSeq]);

    const estimateExpectedDurationSec = useCallback((params: {
        rowsToAnalyze: number;
        modelId: 'bgl' | 'hdfs';
        rowsPerSecondHint: number | null;
        bytesToAnalyze: number | null;
    }): number | null => {
        const { rowsToAnalyze, modelId, rowsPerSecondHint, bytesToAnalyze } = params;
        if (rowsToAnalyze <= 0) {
            return null;
        }

        const largeFileThresholdBytes = 80 * 1024 * 1024;
        const hugeFileThresholdBytes = 300 * 1024 * 1024;
        const largeRowsThreshold = 400_000;
        const hugeRowsThreshold = 1_200_000;
        const isLargeDataset = (bytesToAnalyze ?? 0) >= largeFileThresholdBytes || rowsToAnalyze >= largeRowsThreshold;
        const isHugeDataset = (bytesToAnalyze ?? 0) >= hugeFileThresholdBytes || rowsToAnalyze >= hugeRowsThreshold;

        const safeRowsPerSecondHint = rowsPerSecondHint && rowsPerSecondHint > 0 ? rowsPerSecondHint : null;
        const fallbackBaseRowsPerSecond = modelId === 'hdfs'
            ? (isHugeDataset ? 780 : isLargeDataset ? 620 : 520)
            : (isHugeDataset ? 950 : isLargeDataset ? 1200 : 1600);
        const fallbackBytesPerSecond = modelId === 'hdfs'
            ? (isHugeDataset ? 520_000 : isLargeDataset ? 430_000 : 360_000)
            : (isHugeDataset ? 500_000 : isLargeDataset ? 700_000 : 900_000);

        let averageBytesPerRow: number | null = null;
        if (bytesToAnalyze && bytesToAnalyze > 0) {
            averageBytesPerRow = bytesToAnalyze / Math.max(1, rowsToAnalyze);
        } else if (normalRows.length > 0) {
            const sampleSize = Math.min(normalRows.length, 300);
            const sampleBytes = normalRows
                .slice(0, sampleSize)
                .reduce((sum, row) => sum + row.raw.length, 0);
            averageBytesPerRow = sampleBytes / Math.max(1, sampleSize);
        }

        const complexityFactor = averageBytesPerRow
            ? Math.max(0.9, Math.min(7, averageBytesPerRow / 140))
            : 1.15;

        const rowsPerKiB = bytesToAnalyze && bytesToAnalyze > 0
            ? rowsToAnalyze / Math.max(1, bytesToAnalyze / 1024)
            : null;
        const densityPenalty = rowsPerKiB
            ? Math.max(1, Math.min(2.2, 1 + ((rowsPerKiB - 180) / 220)))
            : 1;

        const conservativeRowsPerSecondHint = safeRowsPerSecondHint
            ? safeRowsPerSecondHint * (modelId === 'hdfs'
                ? (isHugeDataset ? 0.5 : isLargeDataset ? 0.45 : 0.4)
                : (isHugeDataset ? 0.68 : isLargeDataset ? 0.74 : 0.82))
            : null;

        const rawRowsPerSecond = conservativeRowsPerSecondHint ?? fallbackBaseRowsPerSecond;
        const adjustedRowsPerSecond = rawRowsPerSecond / Math.max(0.75, complexityFactor * densityPenalty);
        const maxRowsPerSecondForecast = modelId === 'hdfs'
            ? (isHugeDataset ? 650 : isLargeDataset ? 520 : 430)
            : (isHugeDataset ? 750 : isLargeDataset ? 1000 : 1400);
        const estimatedRowsPerSecond = Math.min(adjustedRowsPerSecond, maxRowsPerSecondForecast);

        const estimatedByRows = rowsToAnalyze / Math.max(1, estimatedRowsPerSecond);
        const estimatedByBytes = bytesToAnalyze && bytesToAnalyze > 0
            ? bytesToAnalyze / fallbackBytesPerSecond
            : 0;

        const fixedInferenceOverheadBaseSec = modelId === 'bgl' ? 16 : 14;
        const overheadWeightByRows = Math.max(0.35, Math.min(1, 12_000 / Math.max(1, rowsToAnalyze)));

        const isSmallDataset = rowsToAnalyze <= 20_000 && ((bytesToAnalyze ?? 0) <= 2 * 1024 * 1024 || bytesToAnalyze == null);
        const smallDatasetWeight = isSmallDataset
            ? Math.max(0, Math.min(1, (20_000 - rowsToAnalyze) / 18_000))
            : 0;
        const smallDatasetColdStartSec = modelId === 'bgl' ? 18 : 22;
        const adaptiveFixedOverheadSec = (fixedInferenceOverheadBaseSec * overheadWeightByRows)
            + (smallDatasetColdStartSec * smallDatasetWeight);

        const startupOverheadSec = conservativeRowsPerSecondHint
            ? (isHugeDataset ? 8 : isLargeDataset ? 5 : 4)
            : (isHugeDataset ? 12 : isLargeDataset ? 8 : 6);
        const sizeOverheadSec = bytesToAnalyze && bytesToAnalyze > 0
            ? Math.min(
                isHugeDataset ? 36 : isLargeDataset ? 24 : 12,
                Math.ceil(bytesToAnalyze / ((isHugeDataset ? 8 : isLargeDataset ? 12 : 18) * 1024 * 1024)),
            )
            : 0;
        const safetyMultiplier = conservativeRowsPerSecondHint
            ? (isHugeDataset ? 1.25 : isLargeDataset ? 1.18 : 1.12)
            : (isHugeDataset ? 1.45 : isLargeDataset ? 1.35 : 1.28);
        const baselineSec = Math.max(estimatedByRows, estimatedByBytes)
            + startupOverheadSec
            + adaptiveFixedOverheadSec
            + sizeOverheadSec;
        const lowerBoundSec = isHugeDataset ? 18 : isLargeDataset ? 8 : rowsToAnalyze >= 10_000 ? 3 : 1;

        return Math.max(lowerBoundSec, Math.round(baselineSec * safetyMultiplier));
    }, [normalRows]);

    useEffect(() => {
        if (anomalyIsRunning) {
            return;
        }

        if (anomalyHasResults) {
            return;
        }

        if (isMonitoring) {
            return;
        }

        if (totalRowsHint > 0) {
            return;
        }

        dispatch(clearAnomalyResults());
        dispatch(setAnomalyRunning({ running: false }));
    }, [anomalyHasResults, anomalyIsRunning, dispatch, isMonitoring, totalRowsHint]);

    useEffect(() => {
        if (!open) return;
        const hasAnalyzableRows = totalRowsHint > 0;
        if (!hasAnalyzableRows) {
            setIsModelReady(false);
            setIsModelReadyLoading(false);
            return;
        }

        let cancelled = false;

        const checkModelReady = async () => {
            setIsModelReadyLoading(true);
            try {
                const models = await getPretrainedModels();
                const selectedModel = models.find((model) => model.modelId === selectedModelId);
                const selectedReady = Boolean(selectedModel && (selectedModel.status === 'ready' || selectedModel.prepared));

                if (!cancelled) {
                    if (selectedReady) {
                        setIsModelReady(true);
                        return;
                    }

                    const fallbackReadyModel = models.find((model) => model.status === 'ready' || model.prepared);
                    if (fallbackReadyModel && (fallbackReadyModel.modelId === 'bgl' || fallbackReadyModel.modelId === 'hdfs')) {
                        setSelectedModelId(fallbackReadyModel.modelId);
                        saveSelectedAnomalyModelId(fallbackReadyModel.modelId);
                        setIsModelReady(true);
                        return;
                    }

                    setIsModelReady(false);
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
    }, [open, selectedModelId, totalRowsHint]);

    useEffect(() => {
        setAnomalySettings(loadAnomalySettings(selectedModelId));
    }, [selectedModelId]);

    const handleSelectedModelChange = useCallback((modelId: 'bgl' | 'hdfs') => {
        setSelectedModelId(modelId);
        saveSelectedAnomalyModelId(modelId);
    }, []);

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
            return;
        }

        const runStartedAt = Date.now();
        const runCancelRequestSeq = cancelRequestSeqRef.current;
        let runBytesToAnalyze: number | null = null;
        dispatch(setAnomalyError(''));
        if (anomalyStorageKey) {
            await deleteAnomalySnapshot(anomalyStorageKey);
        }
        dispatch(clearAnomalyResults());
        const abortController = beginAnomalyPredictionSession(selectedModelId);
        setActiveAbortController(abortController);

        try {
            const settings = anomalySettings;
            const activeFile = remoteIngestId ? null : await requestFileForAnomalyAnalysis();
            if (!remoteIngestId && !activeFile) {
                return;
            }

            const rowsToAnalyze = Math.max(0, totalRowsHint);

            const rowsPerSecond = anomalyRowsPerSecondByModel[selectedModelId];
            const bytesToAnalyze = (remoteIngestId
                ? logFileSize
                : activeFile?.size ?? logFileSize) || null;
            runBytesToAnalyze = bytesToAnalyze;

            const heuristicExpectedDurationSec = estimateExpectedDurationSec({
                rowsToAnalyze,
                modelId: selectedModelId,
                rowsPerSecondHint: rowsPerSecond,
                bytesToAnalyze,
            });
            const historyExpectedDurationSec = estimateExpectedDurationFromHistory({
                modelId: selectedModelId,
                rowsToAnalyze,
                bytesToAnalyze,
            });
            const expectedDurationSec = (() => {
                if (heuristicExpectedDurationSec == null) {
                    return historyExpectedDurationSec;
                }
                if (historyExpectedDurationSec == null) {
                    return heuristicExpectedDurationSec;
                }

                // Keep history only when it is plausibly close to heuristic forecast.
                const lowerBound = Math.floor(heuristicExpectedDurationSec * 0.25);
                const upperBound = Math.ceil(heuristicExpectedDurationSec * 6);
                if (historyExpectedDurationSec < lowerBound || historyExpectedDurationSec > upperBound) {
                    return heuristicExpectedDurationSec;
                }

                return Math.max(historyExpectedDurationSec, heuristicExpectedDurationSec);
            })();

            dispatch(setAnomalyRunning({
                running: true,
                modelId: selectedModelId,
                startedAt: runStartedAt,
                expectedDurationSec,
            }));
            onClose();

            const requestPayload = {
                model_id: selectedModelId,
                text_column: 'message',
                timestamp_column: settings.timestampColumn === 'auto' ? undefined : settings.timestampColumn,
                threshold: settings.threshold,
                step_size: settings.stepSize,
                min_region_lines: settings.minRegionLines,
                include_rows: false,
                include_windows: false,
            };

            const result = remoteIngestId
                ? await predictBglAnomaliesFromIngest(remoteIngestId, requestPayload, {
                    signal: abortController.signal,
                })
                : await predictBglAnomaliesFromFile(activeFile as File, requestPayload, {
                    signal: abortController.signal,
                });

            const totalRows = rowsToAnalyze > 0
                ? rowsToAnalyze
                : Math.max(0, result.meta.total_rows);

            if (abortController.signal.aborted || cancelRequestSeqRef.current !== runCancelRequestSeq) {
                dispatch(setAnomalyStopped());
                return;
            }

            dispatch(setAnomalyResults({
                regions: result.anomaly_regions,
                rowsCount: result.meta.anomaly_rows,
                totalRows,
                analyzedAt: Date.now(),
                modelId: selectedModelId,
                params: {
                    threshold: settings.threshold,
                    stepSize: settings.stepSize,
                    minRegionLines: settings.minRegionLines,
                    analysisScope: 'all',
                    timestampColumn: settings.timestampColumn,
                },
            }));
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                dispatch(setAnomalyStopped());
            } else {
                const message = err instanceof Error ? err.message : 'Anomaly analysis failed';
                if (message.toLowerCase().includes('cancelled')) {
                    dispatch(setAnomalyStopped());
                } else {
                    dispatch(clearAnomalyResults());
                    dispatch(setAnomalyError(message));
                }
            }
        } finally {
            setActiveAbortController((current) => (current === abortController ? null : current));
            endAnomalyPredictionSession(abortController);
            const elapsedSec = Math.max(1, Math.round((Date.now() - runStartedAt) / 1000));

            const analyzedRows = Math.max(0, totalRowsHint);
            if (analyzedRows > 0) {
                const measuredRowsPerSecond = analyzedRows / elapsedSec;
                dispatch(updateAnomalyRowsPerSecond({
                    modelId: selectedModelId,
                    rowsPerSecond: measuredRowsPerSecond,
                }));

                addAnomalyEtaHistorySample({
                    modelId: selectedModelId,
                    rows: analyzedRows,
                    bytes: runBytesToAnalyze,
                    durationSec: elapsedSec,
                    createdAt: Date.now(),
                });
            }

            dispatch(setAnomalyRunning({ running: false }));
        }
    }, [
        anomalyRowsPerSecondByModel,
        anomalySettings,
        anomalyStorageKey,
        dispatch,
        isModelReady,
        logFileSize,
        totalRowsHint,
        estimateExpectedDurationSec,
        requestFileForAnomalyAnalysis,
        remoteIngestId,
        onClose,
        selectedModelId,
    ]);

    useEffect(() => {
        if (!activeAbortController) {
            return;
        }

        activeAbortController.abort();
        setActiveAbortController(null);
    }, [cancelRequestSeq]);

    const selectedSensitivityProfile =
        Math.abs(anomalySettings.threshold - 0.35) < 0.001
        && anomalySettings.stepSize === 5
        && anomalySettings.minRegionLines === 1
            ? 'sensitive'
            : Math.abs(anomalySettings.threshold - 0.5) < 0.001
                && anomalySettings.stepSize === 10
                && anomalySettings.minRegionLines === 2
                ? 'balanced'
                : Math.abs(anomalySettings.threshold - 0.7) < 0.001
                    && anomalySettings.stepSize === 20
                    && anomalySettings.minRegionLines === 3
                    ? 'strict'
                    : null;

    const handleModelChange = (_event: MouseEvent<HTMLElement>, value: 'bgl' | 'hdfs' | null) => {
        if (value) {
            handleSelectedModelChange(value);
        }
    };

    const hasAnalyzableRows = totalRowsHint > 0;
    const isSmallFileIndexing = isIndexing && !isLargeFile;
    const requiresMonitoringReattach = !isStreamView && !remoteIngestId && !hasFileHandle;
    const canRunAnomalyAnalysis = hasAnalyzableRows
        && !isModelReadyLoading
        && isModelReady
        && !isSmallFileIndexing
        && !requiresMonitoringReattach;
    let anomalyDisabledReason: string | undefined;
    if (isSmallFileIndexing) {
        anomalyDisabledReason = 'Дождитесь загрузки данных в базу.';
    } else if (requiresMonitoringReattach) {
        anomalyDisabledReason = 'Выберите файл для мониторинга.';
    } else if (!hasAnalyzableRows) {
        anomalyDisabledReason = 'No log rows to analyze. Load or attach a log file first.';
    } else if (isModelReadyLoading) {
        anomalyDisabledReason = 'Checking model readiness...';
    } else if (!isModelReady) {
        anomalyDisabledReason = `Prepare selected model (${selectedModelId.toUpperCase()}) in Pretrained Models first.`;
    }
    const isAnalyzeDisabled = anomalyIsRunning || !canRunAnomalyAnalysis;
    const analyzeTooltip = isAnalyzeDisabled && anomalyDisabledReason
        ? anomalyDisabledReason
        : 'Analyze anomalies';

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="sm"
        >
            <DialogTitle>Anomaly Analysis</DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                <Stack spacing={1.5}>
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        alignItems={{ sm: 'center' }}
                    >
                        <ToggleButtonGroup
                            size="small"
                            value={selectedModelId}
                            exclusive
                            onChange={handleModelChange}
                            aria-label="model"
                        >
                            <ToggleButton
                                value="bgl"
                                aria-label="model bgl"
                            >
                                <Tooltip
                                    title="Model: BGL"
                                    arrow
                                >
                                    <MemoryIcon fontSize="small" />
                                </Tooltip>
                            </ToggleButton>
                            <ToggleButton
                                value="hdfs"
                                aria-label="model hdfs"
                            >
                                <Tooltip
                                    title="Model: HDFS"
                                    arrow
                                >
                                    <StorageIcon fontSize="small" />
                                </Tooltip>
                            </ToggleButton>
                        </ToggleButtonGroup>

                        <Tooltip
                            title={analyzeTooltip}
                            arrow
                        >
                            <span>
                                <Button
                                    size="small"
                                    variant="contained"
                                    onClick={runAnomalyAnalysis}
                                    startIcon={<TroubleshootIcon />}
                                    disabled={isAnalyzeDisabled}
                                >
                                    Analyze
                                </Button>
                            </span>
                        </Tooltip>
                    </Stack>

                    <Stack spacing={0.5}>
                        <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                        >
                            <Typography variant="subtitle2">Model Analysis Settings</Typography>
                            <Tooltip
                                title="These parameters are applied to anomaly calculation for the selected model."
                                arrow
                            >
                                <InfoOutlinedIcon fontSize="inherit" />
                            </Tooltip>
                        </Stack>
                        <Typography
                            variant="caption"
                            color="text.secondary"
                        >
                            {selectedModelId.toUpperCase()} parameters used for anomaly calculation.
                        </Typography>
                    </Stack>

                    <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1}
                        sx={{ alignItems: { md: 'flex-start' } }}
                    >
                        <Box sx={{ minWidth: 150 }}>
                            <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                sx={{ mb: 0.5 }}
                            >
                                <Typography variant="caption">Threshold</Typography>
                                <Tooltip
                                    title="Lower value finds more anomalies, higher value is stricter."
                                    arrow
                                >
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                fullWidth
                                size="small"
                                type="number"
                                value={anomalySettings.threshold}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    updateAnomalySettings({
                                        threshold: Math.max(ANOMALY_THRESHOLD_RANGE.min, Math.min(ANOMALY_THRESHOLD_RANGE.max, next)),
                                    });
                                }}
                                inputProps={{ min: ANOMALY_THRESHOLD_RANGE.min, max: ANOMALY_THRESHOLD_RANGE.max, step: ANOMALY_THRESHOLD_RANGE.step }}
                            />
                        </Box>
                        <Box sx={{ minWidth: 130 }}>
                            <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                sx={{ mb: 0.5 }}
                            >
                                <Typography variant="caption">Step Size</Typography>
                                <Tooltip
                                    title="Window shift between checks. Smaller is more detailed but slower."
                                    arrow
                                >
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                fullWidth
                                size="small"
                                type="number"
                                value={anomalySettings.stepSize}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    updateAnomalySettings({
                                        stepSize: Math.max(ANOMALY_STEP_SIZE_RANGE.min, Math.min(ANOMALY_STEP_SIZE_RANGE.max, Math.round(next))),
                                    });
                                }}
                                inputProps={{ min: ANOMALY_STEP_SIZE_RANGE.min, max: ANOMALY_STEP_SIZE_RANGE.max, step: ANOMALY_STEP_SIZE_RANGE.step }}
                            />
                        </Box>
                        <Box sx={{ minWidth: 130 }}>
                            <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                sx={{ mb: 0.5 }}
                            >
                                <Typography variant="caption">Min Region</Typography>
                                <Tooltip
                                    title="Minimum continuous anomaly block length to reduce noise."
                                    arrow
                                >
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                fullWidth
                                size="small"
                                type="number"
                                value={anomalySettings.minRegionLines}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    updateAnomalySettings({
                                        minRegionLines: Math.max(ANOMALY_MIN_REGION_LINES_RANGE.min, Math.min(ANOMALY_MIN_REGION_LINES_RANGE.max, Math.round(next))),
                                    });
                                }}
                                inputProps={{ min: ANOMALY_MIN_REGION_LINES_RANGE.min, max: ANOMALY_MIN_REGION_LINES_RANGE.max, step: ANOMALY_MIN_REGION_LINES_RANGE.step }}
                            />
                        </Box>
                    </Stack>

                    <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1}
                    >
                        <Tooltip
                            title="High sensitivity: catches more anomalies, may include noise."
                            arrow
                        >
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'sensitive' ? 'contained' : 'outlined'}
                                onClick={() => applySensitivityProfile('sensitive')}
                            >
                                Sensitive
                            </Button>
                        </Tooltip>
                        <Tooltip
                            title="Balanced mode: recommended default tradeoff."
                            arrow
                        >
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'balanced' ? 'contained' : 'outlined'}
                                onClick={() => applySensitivityProfile('balanced')}
                            >
                                Balanced
                            </Button>
                        </Tooltip>
                        <Tooltip
                            title="Strict mode: fewer false positives, stronger anomaly signal only."
                            arrow
                        >
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'strict' ? 'contained' : 'outlined'}
                                onClick={() => applySensitivityProfile('strict')}
                            >
                                Strict
                            </Button>
                        </Tooltip>
                    </Stack>
                </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button
                    size="small"
                    variant="text"
                    onClick={resetAnomalySettings}
                >Reset
                </Button>
                <Button
                    size="small"
                    onClick={onClose}
                >Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AnomalySettingsDialog;
