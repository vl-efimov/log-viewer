import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
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
    ANOMALY_STEP_SIZE_RANGE,
    ANOMALY_THRESHOLD_RANGE,
    type AnomalySettings,
    loadAnomalySettings,
    loadSelectedAnomalyModelId,
    saveAnomalySettings,
    saveSelectedAnomalyModelId,
} from '../utils/anomalySettings';
import ConfirmActionDialog from './common/ConfirmActionDialog';

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

function getParameterLoadWarning(
    settings: Pick<AnomalySettings, 'stepSize'>,
    t: (key: string, options?: Record<string, unknown>) => string,
): ParameterLoadWarning | null {
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

    return {
        severity,
        message: t(`anomaly.dialog.parameterLoad.${severity}`, {
            stepSize,
            multiplier: multiplierLabel,
        }),
        multiplierLabel,
        shouldConfirmBeforeAnalyze: severity === 'critical',
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
    const { t } = useTranslation();
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
    const [isAnalyzeConfirmOpen, setIsAnalyzeConfirmOpen] = useState(false);
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
                message: t('anomaly.dialog.resultNotification', { count: result.meta.anomaly_rows }),
                severity: 'success',
            }));
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                dispatch(setAnomalyStopped());
            } else {
                const message = err instanceof Error ? err.message : t('anomaly.dialog.errors.failed');
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
        t,
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
    }, t), [anomalySettings.stepSize, t]);

    const setThresholdValue = useCallback((value: number) => {
        updateAnomalySettings({
            threshold: Math.max(ANOMALY_THRESHOLD_RANGE.min, Math.min(ANOMALY_THRESHOLD_RANGE.max, value)),
        });
    }, [updateAnomalySettings]);

    const setStepSizeValue = useCallback((value: number) => {
        updateAnomalySettings({
            stepSize: Math.max(ANOMALY_STEP_SIZE_RANGE.min, Math.min(ANOMALY_STEP_SIZE_RANGE.max, Math.round(value))),
        });
    }, [updateAnomalySettings]);

    const setMinRegionLinesValue = useCallback((value: number) => {
        updateAnomalySettings({
            minRegionLines: Math.max(ANOMALY_MIN_REGION_LINES_RANGE.min, Math.min(ANOMALY_MIN_REGION_LINES_RANGE.max, Math.round(value))),
        });
    }, [updateAnomalySettings]);

    const handleModelChange = (event: SelectChangeEvent<'bgl' | 'hdfs'>) => {
        const value = event.target.value as 'bgl' | 'hdfs';
        handleSelectedModelChange(value);
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
        anomalyDisabledReason = t('anomaly.dialog.disabled.indexing');
    } else if (requiresMonitoringReattach) {
        anomalyDisabledReason = t('anomaly.dialog.disabled.selectFile');
    } else if (!hasAnalyzableRows) {
        anomalyDisabledReason = t('anomaly.dialog.disabled.noRows');
    } else if (isModelReadyLoading) {
        anomalyDisabledReason = t('anomaly.dialog.disabled.checkingModel');
    } else if (!isModelReady) {
        anomalyDisabledReason = t('anomaly.dialog.disabled.prepareModel', { model: selectedModelId.toUpperCase() });
    }
    const isAnalyzeDisabled = anomalyIsRunning || !canRunAnomalyAnalysis;
    const analyzeTooltip = isAnalyzeDisabled && anomalyDisabledReason
        ? anomalyDisabledReason
        : t('anomaly.dialog.analyzeTooltip');

    const confirmAnalyzeMessage = parameterLoadWarning?.shouldConfirmBeforeAnalyze
        ? `${parameterLoadWarning.message} ${t('anomaly.dialog.parameterLoadConfirmSuffix')}`
        : t('anomaly.dialog.parameterLoadConfirmSuffix');

    const handleAnalyzeClick = useCallback(async () => {
        if (isAnalyzeDisabled) {
            return;
        }

        if (parameterLoadWarning?.shouldConfirmBeforeAnalyze) {
            setIsAnalyzeConfirmOpen(true);
            return;
        }

        await runAnomalyAnalysis();
    }, [
        isAnalyzeDisabled,
        parameterLoadWarning,
        runAnomalyAnalysis,
    ]);

    const handleConfirmAnalyze = useCallback(async () => {
        setIsAnalyzeConfirmOpen(false);
        if (isAnalyzeDisabled) {
            return;
        }
        await runAnomalyAnalysis();
    }, [isAnalyzeDisabled, runAnomalyAnalysis]);

    const handleCancelAnalyzeConfirm = useCallback(() => {
        setIsAnalyzeConfirmOpen(false);
    }, []);

    useEffect(() => {
        if (!open || !parameterLoadWarning?.shouldConfirmBeforeAnalyze) {
            setIsAnalyzeConfirmOpen(false);
        }
    }, [open, parameterLoadWarning?.shouldConfirmBeforeAnalyze]);

    return (
        <>
            <Dialog
                open={open}
                onClose={onClose}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: {
                        width: { xs: '92vw', sm: 520 },
                    },
                }}
            >
                <DialogTitle sx={{ pr: 6 }}>
                    {t('anomaly.dialog.title')}
                    <IconButton
                        aria-label={t('common.closeAria')}
                        onClick={onClose}
                        size="small"
                        sx={{ position: 'absolute', right: 8, top: 8 }}
                    >
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{ pt: 1 }}>
                    <Stack spacing={1.5}>
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        alignItems={{ sm: 'center' }}
                    >
                        <Stack
                            spacing={0.5}
                            sx={{ width: { xs: '100%', sm: 300 } }}
                        >
                            <Typography variant="caption">{t('anomaly.dialog.model')}</Typography>
                            <FormControl size="small">
                                <Select
                                    value={selectedModelId}
                                    onChange={handleModelChange}
                                    aria-label={t('anomaly.dialog.modelAria')}
                                >
                                    <MenuItem value="bgl">BGL</MenuItem>
                                    <MenuItem value="hdfs">HDFS</MenuItem>
                                </Select>
                            </FormControl>
                        </Stack>
                    </Stack>

                    <Stack spacing={0.5}>
                        <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                        >
                            <Typography variant="subtitle2">{t('anomaly.dialog.settingsTitle')}</Typography>
                            <Tooltip
                                title={t('anomaly.dialog.settingsTooltip')}
                                arrow
                            >
                                <InfoOutlinedIcon fontSize="inherit" />
                            </Tooltip>
                        </Stack>
                    </Stack>

                    <Stack spacing={1.5}>
                        <Box sx={{ width: { xs: '100%', sm: 300 } }}>
                            <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                sx={{ mb: 0.5 }}
                            >
                                    <Typography variant="caption">{t('anomaly.dialog.threshold')}</Typography>
                                <Tooltip
                                        title={t('anomaly.dialog.thresholdTooltip')}
                                    arrow
                                >
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                size="small"
                                type="number"
                                value={anomalySettings.threshold}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    setThresholdValue(next);
                                }}
                                sx={{ width: 110 }}
                                inputProps={{ min: ANOMALY_THRESHOLD_RANGE.min, max: ANOMALY_THRESHOLD_RANGE.max, step: ANOMALY_THRESHOLD_RANGE.step }}
                            />
                            <Slider
                                size="small"
                                value={anomalySettings.threshold}
                                min={ANOMALY_THRESHOLD_RANGE.min}
                                max={ANOMALY_THRESHOLD_RANGE.max}
                                step={ANOMALY_THRESHOLD_RANGE.step}
                                onChange={(_event, value) => {
                                    const next = Array.isArray(value) ? value[0] : value;
                                    setThresholdValue(next);
                                }}
                                sx={{ mt: 0.75, width: '100%' }}
                            />
                        </Box>
                        <Box sx={{ width: { xs: '100%', sm: 300 } }}>
                            <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                sx={{ mb: 0.5 }}
                            >
                                <Typography variant="caption">{t('anomaly.dialog.stepSize')}</Typography>
                                <Tooltip
                                    title={t('anomaly.dialog.stepSizeTooltip')}
                                    arrow
                                >
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                size="small"
                                type="number"
                                value={anomalySettings.stepSize}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    setStepSizeValue(next);
                                }}
                                sx={{ width: 110 }}
                                inputProps={{ min: ANOMALY_STEP_SIZE_RANGE.min, max: ANOMALY_STEP_SIZE_RANGE.max, step: ANOMALY_STEP_SIZE_RANGE.step }}
                            />
                            <Slider
                                size="small"
                                value={anomalySettings.stepSize}
                                min={ANOMALY_STEP_SIZE_RANGE.min}
                                max={ANOMALY_STEP_SIZE_RANGE.max}
                                step={ANOMALY_STEP_SIZE_RANGE.step}
                                onChange={(_event, value) => {
                                    const next = Array.isArray(value) ? value[0] : value;
                                    setStepSizeValue(next);
                                }}
                                sx={{ mt: 0.75, width: '100%' }}
                            />
                            {parameterLoadWarning && (
                                <Alert
                                    severity={parameterLoadWarning.severity === 'critical' ? 'warning' : 'info'}
                                    variant="outlined"
                                    sx={{ mt: 1, py: 0.25, px: 1 }}
                                >
                                    <Typography variant="caption">
                                        {parameterLoadWarning.message}
                                        {parameterLoadWarning.shouldConfirmBeforeAnalyze
                                            ? ` ${t('anomaly.dialog.parameterLoadNeedsConfirm')}`
                                            : ''}
                                    </Typography>
                                </Alert>
                            )}
                        </Box>
                        <Box sx={{ width: { xs: '100%', sm: 300 } }}>
                            <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                sx={{ mb: 0.5 }}
                            >
                                <Typography variant="caption">{t('anomaly.dialog.minRegion')}</Typography>
                                <Tooltip
                                    title={t('anomaly.dialog.minRegionTooltip')}
                                    arrow
                                >
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                size="small"
                                type="number"
                                value={anomalySettings.minRegionLines}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    setMinRegionLinesValue(next);
                                }}
                                sx={{ width: 110 }}
                                inputProps={{ min: ANOMALY_MIN_REGION_LINES_RANGE.min, max: ANOMALY_MIN_REGION_LINES_RANGE.max, step: ANOMALY_MIN_REGION_LINES_RANGE.step }}
                            />
                            <Slider
                                size="small"
                                value={anomalySettings.minRegionLines}
                                min={ANOMALY_MIN_REGION_LINES_RANGE.min}
                                max={ANOMALY_MIN_REGION_LINES_RANGE.max}
                                step={ANOMALY_MIN_REGION_LINES_RANGE.step}
                                onChange={(_event, value) => {
                                    const next = Array.isArray(value) ? value[0] : value;
                                    setMinRegionLinesValue(next);
                                }}
                                sx={{ mt: 0.75, width: '100%' }}
                            />
                        </Box>
                    </Stack>

                        <Stack
                            direction={{ xs: 'column', md: 'row' }}
                            spacing={1}
                        >
                        <Tooltip
                            title={t('anomaly.dialog.profileSensitiveTooltip')}
                            arrow
                        >
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'sensitive' ? 'contained' : 'outlined'}
                                onClick={() => applySensitivityProfile('sensitive')}
                            >
                                {t('anomaly.dialog.profileSensitive')}
                            </Button>
                        </Tooltip>
                        <Tooltip
                            title={t('anomaly.dialog.profileBalancedTooltip')}
                            arrow
                        >
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'balanced' ? 'contained' : 'outlined'}
                                onClick={() => applySensitivityProfile('balanced')}
                            >
                                {t('anomaly.dialog.profileBalanced')}
                            </Button>
                        </Tooltip>
                        <Tooltip
                            title={t('anomaly.dialog.profileStrictTooltip')}
                            arrow
                        >
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'strict' ? 'contained' : 'outlined'}
                                onClick={() => applySensitivityProfile('strict')}
                            >
                                {t('anomaly.dialog.profileStrict')}
                            </Button>
                        </Tooltip>
                        </Stack>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button
                        size="small"
                        onClick={onClose}
                    >
                        {t('anomaly.dialog.close')}
                    </Button>
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
                                {t('anomaly.dialog.analyze')}
                            </Button>
                        </span>
                    </Tooltip>
                </DialogActions>
            </Dialog>
            <ConfirmActionDialog
                open={isAnalyzeConfirmOpen}
                message={confirmAnalyzeMessage}
                onConfirm={() => {
                    void handleConfirmAnalyze();
                }}
                onCancel={handleCancelAnalyzeConfirm}
                confirmLabel={t('common.ok')}
                cancelLabel={t('common.cancel')}
            />
        </>
    );
};
export default AnomalySettingsDialog;
