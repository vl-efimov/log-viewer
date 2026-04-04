import Box from '@mui/material/Box';
import Badge from '@mui/material/Badge';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import StreamIcon from '@mui/icons-material/Stream';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FilterListIcon from '@mui/icons-material/FilterList';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../redux/store';
import {
    clearAnomalyResults,
    setAnomalyError,
    setAnomalyLastDurationSec,
    setAnomalyResults,
    setAnomalyRunning,
    updateAnomalyRowsPerSecond,
} from '../redux/slices/logFileSlice';
import { isBglModelReady, predictBglAnomalies, predictBglAnomaliesFromFile } from '../services/bglAnomalyApi';
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
import type { ParsedLogLine } from '../utils/logFormatDetector';
import AnomalySettingsDialog from './AnomalySettingsDialog';
import { LogFiltersBar } from './LogFiltersBar';
import type { LogFilters } from '../types/filters';
import type { LogFormatField } from '../utils/logFormatDetector';

type AnomalySourceRow = {
    lineNumber: number;
    raw: string;
};

type ParsedRow = {
    lineNumber: number;
    parsed: ParsedLogLine | null;
    raw: string;
};

interface LogToolbarProps {
    onManualRefresh: () => void;
    autoRefresh: boolean;
    onToggleAutoRefresh: () => void;
    viewMode: 'live-tail' | 'normal';
    onViewModeChange: (mode: 'live-tail' | 'normal') => void;
    newLinesCount: number;
    filters: LogFilters;
    onFiltersChange: (filters: LogFilters) => void;
    fieldDefinitions: LogFormatField[];
    isLargeFile: boolean;
    lineCount: number;
    normalRows: AnomalySourceRow[];
    filteredRows: AnomalySourceRow[];
    getActiveFile: () => Promise<File | null>;
    getParsedRow: (row: AnomalySourceRow) => ParsedRow;
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
    filteredRows,
    getActiveFile,
    getParsedRow,
}) => {
    const dispatch = useDispatch();
    const { isMonitoring, anomalyIsRunning, anomalyRowsPerSecondByModel } = useSelector<RootState, RootState['logFile']>((state) => state.logFile);
    const [selectedModelId, setSelectedModelId] = useState<'bgl' | 'hdfs'>(() => loadSelectedAnomalyModelId());
    const [anomalySettings, setAnomalySettings] = useState<AnomalySettings>(() => loadAnomalySettings(loadSelectedAnomalyModelId()));
    const [isAnomalySettingsPanelOpen, setIsAnomalySettingsPanelOpen] = useState<boolean>(false);
    const [isModelReady, setIsModelReady] = useState<boolean>(false);
    const [isModelReadyLoading, setIsModelReadyLoading] = useState<boolean>(false);
    const [filtersAnchorEl, setFiltersAnchorEl] = useState<HTMLElement | null>(null);

    const handleViewModeChange = (_event: React.MouseEvent<HTMLElement>, value: 'live-tail' | 'normal' | null) => {
        if (value) {
            onViewModeChange(value);
        }
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
    }, [
        anomalyRowsPerSecondByModel,
        anomalySettings,
        dispatch,
        filteredRows,
        getActiveFile,
        getParsedRow,
        isLargeFile,
        isModelReady,
        lineCount,
        normalRows,
        selectedModelId,
    ]);

    const canRunAnomalyAnalysis = !isModelReadyLoading && isModelReady;
    const anomalyDisabledReason = isModelReadyLoading
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
                    py: 1,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    flexWrap: 'wrap',
                }}
                elevation={0}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Refresh now" arrow>
                        <IconButton size="small" onClick={onManualRefresh} aria-label="refresh now">
                            <RefreshIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>

                    <Tooltip title={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'} arrow>
                        <IconButton
                            size="small"
                            onClick={onToggleAutoRefresh}
                            color={autoRefresh ? 'success' : 'default'}
                            aria-label="toggle auto refresh"
                        >
                            <AutorenewIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>

                <Divider orientation="vertical" flexItem />

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Anomaly settings" arrow>
                        <IconButton
                            size="small"
                            color={isAnomalySettingsPanelOpen ? 'primary' : 'default'}
                            onClick={() => setIsAnomalySettingsPanelOpen((prev) => !prev)}
                            aria-label="anomaly settings"
                        >
                            <AutoAwesomeIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>

                <Divider orientation="vertical" flexItem />

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ToggleButtonGroup
                        size="small"
                        value={viewMode}
                        exclusive
                        onChange={handleViewModeChange}
                        aria-label="log view mode"
                    >
                        <Tooltip title="Live tail" arrow>
                            <ToggleButton value="live-tail" aria-label="live tail">
                                <StreamIcon fontSize="small" />
                            </ToggleButton>
                        </Tooltip>
                        <Tooltip title="Normal view" arrow>
                            <ToggleButton value="normal" aria-label="normal view">
                                <FormatListBulletedIcon fontSize="small" />
                            </ToggleButton>
                        </Tooltip>
                    </ToggleButtonGroup>

                    {newLinesCount > 0 && (
                        <Tooltip title={`${newLinesCount} new lines`} arrow>
                            <span>
                                <IconButton size="small" aria-label="new lines" disabled>
                                    <Badge badgeContent={newLinesCount} color="success" max={999}>
                                        <NotificationsIcon fontSize="small" />
                                    </Badge>
                                </IconButton>
                            </span>
                        </Tooltip>
                    )}
                </Box>

                <Box 
                    sx={{
                        ml: 'auto',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    <Tooltip
                        title="Filters"
                        arrow
                    >
                        <IconButton
                            size="small"
                            aria-label="filters"
                            onClick={(event) => setFiltersAnchorEl(event.currentTarget)}
                            color={activeFiltersCount > 0 ? 'primary' : 'default'}
                        >
                            <Badge
                                color="primary"
                                badgeContent={activeFiltersCount}
                                invisible={activeFiltersCount === 0}
                            >
                                <FilterListIcon fontSize="small" />
                            </Badge>
                        </IconButton>
                    </Tooltip>
                </Box>
            </Paper>

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
