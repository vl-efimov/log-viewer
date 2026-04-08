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
import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../redux/store';
import {
    clearAnomalyResults,
    setAnomalyError,
    setAnomalyLastDurationSec,
    setAnomalyResults,
    setAnomalyRunning,
    setAnomalyStopped,
    updateAnomalyRowsPerSecond,
} from '../redux/slices/anomalySlice';
import { getPretrainedModels, predictBglAnomaliesFromFile } from '../services/bglAnomalyApi';
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

interface AnomalySettingsDialogProps {
    open: boolean;
    onClose: () => void;
    isStreamView: boolean;
    lineCount: number;
    normalRows: AnomalySourceRow[];
    requestFileForAnomalyAnalysis: () => Promise<File | null>;
}

const AnomalySettingsDialog: React.FC<AnomalySettingsDialogProps> = ({
    open,
    onClose,
    isStreamView,
    lineCount,
    normalRows,
    requestFileForAnomalyAnalysis,
}) => {
    const dispatch = useDispatch();
    const { isMonitoring } = useSelector((state: RootState) => state.logFile);
    const {
        isRunning: anomalyIsRunning,
        cancelRequestSeq,
        rowsPerSecondByModel: anomalyRowsPerSecondByModel,
    } = useSelector((state: RootState) => state.anomaly);
    const [selectedModelId, setSelectedModelId] = useState<'bgl' | 'hdfs'>(() => loadSelectedAnomalyModelId());
    const [anomalySettings, setAnomalySettings] = useState<AnomalySettings>(() => loadAnomalySettings(loadSelectedAnomalyModelId()));
    const [isModelReady, setIsModelReady] = useState<boolean>(false);
    const [isModelReadyLoading, setIsModelReadyLoading] = useState<boolean>(false);
    const [activeAbortController, setActiveAbortController] = useState<AbortController | null>(null);

    useEffect(() => {
        if (isMonitoring) {
            return;
        }

        if (!isStreamView && normalRows.length > 0) {
            return;
        }

        if (isStreamView && lineCount > 0) {
            return;
        }

        dispatch(clearAnomalyResults());
        dispatch(setAnomalyRunning({ running: false }));
    }, [dispatch, isMonitoring, isStreamView, lineCount, normalRows.length]);

    useEffect(() => {
        if (!open) return;
        const hasAnalyzableRows = isStreamView ? lineCount > 0 : normalRows.length > 0;
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
    }, [open, isStreamView, lineCount, normalRows.length, selectedModelId]);

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
        dispatch(setAnomalyError(''));
        const abortController = new AbortController();
        setActiveAbortController(abortController);

        try {
            const settings = anomalySettings;
            const activeFile = await requestFileForAnomalyAnalysis();
            if (!activeFile) {
                return;
            }

            const rowsToAnalyze = isStreamView
                ? Math.max(0, lineCount)
                : normalRows.length;

            const rowsPerSecond = anomalyRowsPerSecondByModel[selectedModelId];
            const expectedDurationSec = rowsPerSecond && rowsPerSecond > 0
                ? Math.max(1, Math.round(rowsToAnalyze / rowsPerSecond))
                : null;

            dispatch(setAnomalyRunning({
                running: true,
                modelId: selectedModelId,
                startedAt: runStartedAt,
                expectedDurationSec,
            }));

            const result = await predictBglAnomaliesFromFile(activeFile, {
                model_id: selectedModelId,
                text_column: 'message',
                timestamp_column: settings.timestampColumn === 'auto' ? undefined : settings.timestampColumn,
                threshold: settings.threshold,
                step_size: settings.stepSize,
                min_region_lines: settings.minRegionLines,
                include_rows: false,
                include_windows: false,
            }, {
                signal: abortController.signal,
            });

            const anomalyRowLines = Array.isArray(result.anomaly_lines)
                ? result.anomaly_lines
                : (result.rows ?? [])
                    .filter((row) => row.is_anomaly)
                    .map((row) => row.line);

            const anomalyLineNumbers = anomalyRowLines
                .filter((lineNumber): lineNumber is number => typeof lineNumber === 'number' && Number.isFinite(lineNumber));

            dispatch(setAnomalyResults({
                regions: result.anomaly_regions,
                lineNumbers: anomalyLineNumbers,
                rowsCount: result.meta.anomaly_rows,
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
            const elapsedSec = Math.max(1, Math.round((Date.now() - runStartedAt) / 1000));
            dispatch(setAnomalyLastDurationSec(elapsedSec));

            const analyzedRows = isStreamView ? Math.max(0, lineCount) : normalRows.length;
            if (analyzedRows > 0) {
                const measuredRowsPerSecond = analyzedRows / elapsedSec;
                dispatch(updateAnomalyRowsPerSecond({
                    modelId: selectedModelId,
                    rowsPerSecond: measuredRowsPerSecond,
                }));
            }

            dispatch(setAnomalyRunning({ running: false }));
        }
    }, [
        anomalyRowsPerSecondByModel,
        anomalySettings,
        dispatch,
        isModelReady,
        isStreamView,
        lineCount,
        normalRows.length,
        requestFileForAnomalyAnalysis,
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

    const hasAnalyzableRows = isStreamView ? lineCount > 0 : normalRows.length > 0;
    const canRunAnomalyAnalysis = hasAnalyzableRows && !isModelReadyLoading && isModelReady;
    const anomalyDisabledReason = !hasAnalyzableRows
        ? 'No log rows to analyze. Load or attach a log file first.'
        : isModelReadyLoading
            ? 'Checking model readiness...'
            : isModelReady
                ? undefined
                : `Prepare selected model (${selectedModelId.toUpperCase()}) in Pretrained Models first.`;
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

                    {!anomalyIsRunning && !canRunAnomalyAnalysis && anomalyDisabledReason && (
                        <Alert
                            severity="info"
                            variant="outlined"
                            sx={{ py: 0.25 }}
                        >
                            {anomalyDisabledReason}
                        </Alert>
                    )}

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
