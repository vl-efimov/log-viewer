import Alert from '@mui/material/Alert';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../redux/store';
import {
    clearAnomalyResults,
    setAnomalyError,
    setAnomalyResults,
    setAnomalyRunning,
    setAnomalyStopped,
} from '../redux/slices/anomalySlice';
import { enqueueNotification } from '../redux/slices/notificationsSlice';
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

type ParameterLoadSeverity = 'none' | 'elevated' | 'high' | 'critical';

type ParameterLoadWarning = {
    severity: ParameterLoadSeverity;
    message: string;
    multiplierLabel: string;
    shouldConfirmBeforeAnalyze: boolean;
};

function formatMultiplier(multiplier: number): string {
    const rounded = Math.round(multiplier * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getParameterLoadWarning(settings: Pick<AnomalySettings, 'stepSize'>): ParameterLoadWarning | null {
    const stepSize = Math.max(1, Math.round(settings.stepSize));

    let severityScore = 0;
    if (stepSize <= 5) {
        severityScore = 3;
    } else if (stepSize <= 9) {
        severityScore = 2;
    } else if (stepSize <= 15) {
        severityScore = 1;
    }

    const normalizedScore = Math.min(3, severityScore);
    if (normalizedScore <= 0) {
        return null;
    }

    const multiplier = 20 / stepSize;
    const multiplierLabel = formatMultiplier(multiplier);
    const severity: ParameterLoadSeverity = normalizedScore === 1
        ? 'elevated'
        : normalizedScore === 2
            ? 'high'
            : 'critical';

    if (severity === 'critical') {
        return {
            severity,
            message: `Эти параметры приведут к значительному увеличению расчета: шаг ${stepSize} дает примерно x${multiplierLabel} проверок относительно шага 20.`,
            multiplierLabel,
            shouldConfirmBeforeAnalyze: true,
        };
    }

    if (severity === 'high') {
        return {
            severity,
            message: `Текущие параметры заметно увеличат объем расчета (примерно x${multiplierLabel} проверок относительно шага 20).`,
            multiplierLabel,
            shouldConfirmBeforeAnalyze: false,
        };
    }

    return {
        severity,
        message: `Текущие параметры увеличат объем расчета (примерно x${multiplierLabel} проверок относительно шага 20).`,
        multiplierLabel,
        shouldConfirmBeforeAnalyze: false,
    };
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
    } = useSelector((state: RootState) => state.logFile);
    const {
        hasResults: anomalyHasResults,
        isRunning: anomalyIsRunning,
        cancelRequestSeq,
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
            sensitive: { threshold: 0.4, stepSize: 20, minRegionLines: 1 },
            balanced: { threshold: 0.6, stepSize: 20, minRegionLines: 1 },
            strict: { threshold: 0.8, stepSize: 20, minRegionLines: 1 },
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

    const runAnomalyAnalysis = useCallback(async (prefetchedFile?: File | null) => {
        if (!isModelReady) {
            return;
        }

        const runCancelRequestSeq = cancelRequestSeqRef.current;
        dispatch(setAnomalyError(''));
        if (anomalyStorageKey) {
            await deleteAnomalySnapshot(anomalyStorageKey);
        }
        dispatch(clearAnomalyResults());
        const abortController = beginAnomalyPredictionSession(selectedModelId);
        setActiveAbortController(abortController);

        try {
            const settings = anomalySettings;
            const activeFile = remoteIngestId
                ? null
                : (prefetchedFile ?? await requestFileForAnomalyAnalysis());
            if (!remoteIngestId && !activeFile) {
                return;
            }

            const rowsToAnalyze = Math.max(0, totalRowsHint, normalRows.length);

            dispatch(setAnomalyRunning({
                running: true,
                modelId: selectedModelId,
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
            dispatch(enqueueNotification({
                message: `Расчет аномалий завершен. Найдено аномальных строк: ${result.meta.anomaly_rows}.`,
                severity: 'success',
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
            dispatch(setAnomalyRunning({ running: false }));
        }
    }, [
        anomalySettings,
        anomalyStorageKey,
        dispatch,
        isModelReady,
        totalRowsHint,
        normalRows.length,
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
        Math.abs(anomalySettings.threshold - 0.4) < 0.001
        && anomalySettings.stepSize === 20
        && anomalySettings.minRegionLines === 1
            ? 'sensitive'
            : Math.abs(anomalySettings.threshold - 0.6) < 0.001
                && anomalySettings.stepSize === 20
                && anomalySettings.minRegionLines === 1
                ? 'balanced'
                : Math.abs(anomalySettings.threshold - 0.8) < 0.001
                    && anomalySettings.stepSize === 20
                    && anomalySettings.minRegionLines === 1
                    ? 'strict'
                    : null;

    const parameterLoadWarning = useMemo(() => getParameterLoadWarning({
        stepSize: anomalySettings.stepSize,
    }), [anomalySettings.stepSize]);

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

    const handleAnalyzeClick = useCallback(async () => {
        if (isAnalyzeDisabled) {
            return;
        }

        let prefetchedFile: File | null | undefined;
        if (!remoteIngestId && parameterLoadWarning?.shouldConfirmBeforeAnalyze) {
            // Keep file request in the original click chain before confirm to preserve user-activation APIs.
            prefetchedFile = await requestFileForAnomalyAnalysis();
            if (!prefetchedFile) {
                return;
            }
        }

        if (parameterLoadWarning?.shouldConfirmBeforeAnalyze) {
            const shouldContinue = window.confirm(
                `${parameterLoadWarning.message}\n\nПродолжить анализ с текущими параметрами?`,
            );
            if (!shouldContinue) {
                return;
            }
        }

        await runAnomalyAnalysis(prefetchedFile);
    }, [
        isAnalyzeDisabled,
        parameterLoadWarning,
        remoteIngestId,
        requestFileForAnomalyAnalysis,
        runAnomalyAnalysis,
    ]);

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
                                    onClick={handleAnalyzeClick}
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

                    {parameterLoadWarning && (
                        <Alert
                            severity={parameterLoadWarning.severity === 'critical' ? 'warning' : 'info'}
                            variant="outlined"
                            sx={{ py: 0.25, px: 1 }}
                        >
                            <Typography variant="caption">
                                {parameterLoadWarning.message}
                                {parameterLoadWarning.shouldConfirmBeforeAnalyze
                                    ? ' Перед запуском потребуется подтверждение.'
                                    : ''}
                            </Typography>
                        </Alert>
                    )}

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
