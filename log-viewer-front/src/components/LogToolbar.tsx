import Box from '@mui/material/Box';
import Badge from '@mui/material/Badge';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../redux/store';
import { ViewModeEnum } from '../constants/ViewModeEnum';
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
import AnomalySettingsDialog from './AnomalySettingsDialog';
import { LogFiltersBar } from './LogFiltersBar';
import type { LogFilters } from '../types/filters';
import type { LogFormatField } from '../utils/logFormatDetector';

type AnomalySourceRow = {
    lineNumber: number;
    raw: string;
};

interface LogToolbarProps {
    onManualRefresh: () => void;
    autoRefresh: boolean;
    onToggleAutoRefresh: () => void;
    viewMode: ViewModeEnum;
    onViewModeChange: (mode: ViewModeEnum) => void;
    newLinesCount: number;
    filters: LogFilters;
    onFiltersChange: (filters: LogFilters) => void;
    fieldDefinitions: LogFormatField[];
    isLargeFile: boolean;
    lineCount: number;
    normalRows: AnomalySourceRow[];
    requestFileForAnomalyAnalysis: () => Promise<File | null>;
}

const LogToolbar: React.FC<LogToolbarProps> = ({
    onManualRefresh,
    autoRefresh,
    onToggleAutoRefresh,
    viewMode,
    onViewModeChange,
    newLinesCount,
    filters,
    onFiltersChange,
    fieldDefinitions,
    isLargeFile,
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
    const [isAnomalySettingsPanelOpen, setIsAnomalySettingsPanelOpen] = useState<boolean>(false);
    const [isModelReady, setIsModelReady] = useState<boolean>(false);
    const [isModelReadyLoading, setIsModelReadyLoading] = useState<boolean>(false);
    const [filtersAnchorEl, setFiltersAnchorEl] = useState<HTMLElement | null>(null);
    const [activeAbortController, setActiveAbortController] = useState<AbortController | null>(null);

    const compactButtonSx = {
        minWidth: 0,
        px: 0.75,
        py: 0.25,
        textTransform: 'none' as const,
        fontSize: '0.75rem',
        lineHeight: 1,
        '& .MuiButton-startIcon': {
            marginRight: 0.5,
            marginLeft: 0,
        },
    };

    const activeFiltersCount = Object.keys(filters).filter((key) => {
        const value = filters[key];
        if (!value) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object' && 'value' in value) return Boolean(value.value);
        if (typeof value === 'object' && ('start' in value || 'end' in value)) {
            return Boolean(value.start || value.end);
        }
        return false;
    }).length;

    const isFiltersOpen = Boolean(filtersAnchorEl);

    useEffect(() => {
        if (isMonitoring) {
            return;
        }

        if (!isLargeFile && normalRows.length > 0) {
            return;
        }

        if (isLargeFile && lineCount > 0) {
            return;
        }

        dispatch(clearAnomalyResults());
        dispatch(setAnomalyRunning({ running: false }));
    }, [dispatch, isLargeFile, isMonitoring, lineCount, normalRows.length]);

    useEffect(() => {
        const hasAnalyzableRows = isLargeFile ? lineCount > 0 : normalRows.length > 0;
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
    }, [isLargeFile, lineCount, normalRows.length, selectedModelId]);

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

            const rowsToAnalyze = isLargeFile
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

            const analyzedRows = isLargeFile ? Math.max(0, lineCount) : normalRows.length;
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
        isLargeFile,
        isModelReady,
        lineCount,
        normalRows,
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

    const hasAnalyzableRows = isLargeFile ? lineCount > 0 : normalRows.length > 0;
    const canRunAnomalyAnalysis = hasAnalyzableRows && !isModelReadyLoading && isModelReady;
    const anomalyDisabledReason = !hasAnalyzableRows
        ? 'No log rows to analyze. Load or attach a log file first.'
        : isModelReadyLoading
            ? 'Checking model readiness...'
            : isModelReady
                ? undefined
                : `Prepare selected model (${selectedModelId.toUpperCase()}) in Pretrained Models first.`;

    return (
        <>
            <Paper
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    mb: 1,
                    px: 1.5,
                    py: 0.5,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                }}
                elevation={0}
            >
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.25
                    }}
                >
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                    >
                        Порядок
                    </Typography>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            px: 0.5,
                            py: 0.25,
                        }}
                    >
                        <Tooltip
                            title="С начала"
                            arrow
                        >
                            <Button
                                size="small"
                                variant={viewMode === ViewModeEnum.FromStart ? 'contained' : 'outlined'}
                                onClick={() => onViewModeChange(ViewModeEnum.FromStart)}
                                startIcon={<VerticalAlignBottomIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                С начала
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title="С конца"
                            arrow
                        >
                            <Button
                                size="small"
                                variant={viewMode === ViewModeEnum.FromEnd ? 'contained' : 'outlined'}
                                onClick={() => onViewModeChange(ViewModeEnum.FromEnd)}
                                startIcon={<VerticalAlignTopIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                С конца
                            </Button>
                        </Tooltip>
                    </Box>
                </Box>

                <Divider
                    orientation="vertical"
                    flexItem
                />

                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.25
                    }}
                >
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                    >
                        Обновление
                    </Typography>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1
                        }}
                    >
                        <Tooltip
                            title="Refresh now"
                            arrow
                        >
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={onManualRefresh}
                                startIcon={<RefreshIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                Обновить
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
                            arrow
                        >
                            <Button
                                size="small"
                                variant={autoRefresh ? 'contained' : 'outlined'}
                                color={autoRefresh ? 'success' : 'inherit'}
                                onClick={onToggleAutoRefresh}
                                startIcon={<AutorenewIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                Авто
                            </Button>
                        </Tooltip>
                    </Box>
                </Box>

                <Divider
                    orientation="vertical"
                    flexItem
                />

                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                    >
                        Аномалии
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Tooltip
                            title="Anomaly settings"
                            arrow
                        >
                            <Button
                                size="small"
                                variant={isAnomalySettingsPanelOpen ? 'contained' : 'outlined'}
                                onClick={() => setIsAnomalySettingsPanelOpen((prev) => !prev)}
                                startIcon={<AutoAwesomeIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                Настройки
                            </Button>
                        </Tooltip>
                    </Box>
                </Box>

                <Divider
                    orientation="vertical"
                    flexItem
                />

                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                    >
                        Уведомления
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Tooltip
                            title={`${newLinesCount} new lines`}
                            arrow
                        >
                            <span>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    disabled={newLinesCount === 0}
                                    startIcon={(
                                        <Badge
                                            badgeContent={newLinesCount}
                                            color="success"
                                            max={999}
                                            invisible={newLinesCount === 0}
                                        >
                                            <NotificationsIcon fontSize="small" />
                                        </Badge>
                                    )}
                                    sx={compactButtonSx}
                                >
                                    Новые
                                </Button>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>

                <Box
                    sx={{
                        ml: 'auto',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                        <Tooltip
                            title="Filters"
                            arrow
                        >
                            <Badge
                                color="secondary"
                                badgeContent={activeFiltersCount}
                                invisible={activeFiltersCount === 0}
                            >
                                <Button
                                    size="small"
                                    variant='outlined'
                                    onClick={(event) => setFiltersAnchorEl(event.currentTarget)}
                                    startIcon={(
                                        <FilterAltIcon fontSize="small" />
                                    )}
                                    sx={compactButtonSx}
                                >
                                    Фильтры
                                </Button>
                            </Badge>

                        </Tooltip>
                    </Box>
                </Box>
            </Paper >

            <Popover
                open={isFiltersOpen}
                anchorEl={filtersAnchorEl}
                onClose={() => setFiltersAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <LogFiltersBar
                    filters={filters}
                    onFiltersChange={onFiltersChange}
                    fieldDefinitions={fieldDefinitions}
                />
            </Popover>

            <AnomalySettingsDialog
                open={isAnomalySettingsPanelOpen}
                onClose={() => setIsAnomalySettingsPanelOpen(false)}
                selectedModelId={selectedModelId}
                anomalySettings={anomalySettings}
                thresholdRange={ANOMALY_THRESHOLD_RANGE}
                stepSizeRange={ANOMALY_STEP_SIZE_RANGE}
                minRegionLinesRange={ANOMALY_MIN_REGION_LINES_RANGE}
                isAnomalyLoading={anomalyIsRunning}
                canRunAnomalyAnalysis={canRunAnomalyAnalysis}
                anomalyDisabledReason={anomalyDisabledReason}
                onAnomalySettingsChange={updateAnomalySettings}
                onSensitivityProfileApply={applySensitivityProfile}
                onResetAnomalySettings={resetAnomalySettings}
                onSelectedModelChange={handleSelectedModelChange}
                onRunAnomalyAnalysis={runAnomalyAnalysis}
            />
        </>
    );
};

export default LogToolbar;
