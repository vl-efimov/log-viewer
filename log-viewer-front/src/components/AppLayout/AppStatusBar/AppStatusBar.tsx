import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import DescriptionIcon from '@mui/icons-material/Description';
import CloseIcon from '@mui/icons-material/Close';
import StorageIcon from '@mui/icons-material/Storage';
import DataObjectIcon from '@mui/icons-material/DataObject';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { RootState } from '../../../redux/store';
import { baseUrl } from '../../../constants/BaseUrl';
import { RouteViewLogs } from '../../../routes/routePaths';
import { requestFormatChange, setIndexingState } from '../../../redux/slices/logFileSlice';
import { requestAnomalyCancel, setAnomalyError, setAnomalyRunning, setAnomalyStopped } from '../../../redux/slices/anomalySlice';
import {
    cancelActiveAnomalyPredictionSession,
    cancelActiveRemoteUploadSession,
    cancelBglAnomalyPrediction,
    getBglAnomalyProgress,
} from '../../../services/bglAnomalyApi';
import { getAvailableLogFormats, getLogFormatById } from '../../../utils/logFormatDetector';
import AppStatusBarItem from '../AppStatusBarItem';
import {
    anomalyTextSx,
    closeButtonSx,
    statusBarDividerSx,
    iconRaisedSx,
    statusBarIconSx,
    statusBarLeftGroupSx,
    statusBarRightGroupSx,
    statusBarSx,
    textSx,
} from './styles';

type AnomalyWindowProgress = {
    percent: number | null;
    processedWindows: number;
    totalWindows: number;
    processedRows: number;
    totalRows: number;
    stage: string;
};

type AnomalyStatusText = {
    compact: string;
    full: string;
    detailsCompact?: string;
    detailsFull?: React.ReactNode;
    showSpinner?: boolean;
};

const AppStatusBar: React.FC = () => {
    const dispatch = useDispatch();
    const location = useLocation();
    const {
        name,
        size,
        format,
        loaded,
        isIndexing,
        indexingProgress,
        isLargeFile,
        analyticsSessionId,
    } = useSelector((state: RootState) => state.logFile);
    const {
        rowsCount: anomalyRowsCount,
        totalRows: anomalyTotalRows,
        error: anomalyError,
        isStopped: anomalyIsStopped,
        stoppedAt: anomalyStoppedAt,
        lastAnalyzedAt: anomalyLastAnalyzedAt,
        lastModelId: anomalyLastModelId,
        isRunning: anomalyIsRunning,
        runningModelId: anomalyRunningModelId,
        lastRunParams: anomalyLastRunParams,
    } = useSelector((state: RootState) => state.anomaly);
    const [anomalyWindowProgress, setAnomalyWindowProgress] = useState<AnomalyWindowProgress | null>(null);

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    };

    const currentPath = location.pathname.replace(/\/+$/, '');
    const fullViewLogsPath = `${baseUrl}${RouteViewLogs}`.replace(/\/+/g, '/').replace(/\/+$/, '');
    const isViewLogsRoute = currentPath === fullViewLogsPath;
    const isServerUploadInProgress = isIndexing && isLargeFile && !analyticsSessionId.startsWith('remote:');

    const normalizedFormatId = (format || '').trim() || 'unknown';
    const formatDisplayName = getLogFormatById(normalizedFormatId)?.name ?? normalizedFormatId;
    const formatChangeDisabled = !isViewLogsRoute || !loaded || isIndexing || isServerUploadInProgress;
    const [isFormatDialogOpen, setIsFormatDialogOpen] = useState(false);
    const [formatSearchQuery, setFormatSearchQuery] = useState('');
    const formatSearchInputRef = useRef<HTMLInputElement | null>(null);
    const availableFormatOptions = getAvailableLogFormats()
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((formatOption) => ({ id: formatOption.id, name: formatOption.name }));

    if (!availableFormatOptions.some((option) => option.id === 'unknown')) {
        availableFormatOptions.unshift({ id: 'unknown', name: 'Unknown' });
    }

    if (normalizedFormatId !== 'unknown' && !availableFormatOptions.some((option) => option.id === normalizedFormatId)) {
        availableFormatOptions.unshift({ id: normalizedFormatId, name: formatDisplayName });
    }

    const orderedFormatOptions = useMemo(() => {
        const currentOption = availableFormatOptions.find((option) => option.id === normalizedFormatId);
        const otherOptions = availableFormatOptions.filter((option) => option.id !== normalizedFormatId);

        return currentOption ? [currentOption, ...otherOptions] : availableFormatOptions;
    }, [availableFormatOptions, normalizedFormatId]);

    const filteredFormatOptions = useMemo(() => {
        const normalizedQuery = formatSearchQuery.trim().toLocaleLowerCase();
        if (!normalizedQuery) {
            return orderedFormatOptions;
        }

        return orderedFormatOptions.filter((option) => option.name.toLocaleLowerCase().includes(normalizedQuery));
    }, [orderedFormatOptions, formatSearchQuery]);

    const handleFormatDialogOpen = () => {
        if (formatChangeDisabled) {
            return;
        }
        setFormatSearchQuery('');
        setIsFormatDialogOpen(true);
    };

    const handleFormatDialogClose = () => {
        setIsFormatDialogOpen(false);
        setFormatSearchQuery('');
    };

    const handleFormatSelect = (formatId: string) => {
        dispatch(requestFormatChange(formatId));
        setIsFormatDialogOpen(false);
    };

    useEffect(() => {
        if (formatChangeDisabled) {
            setIsFormatDialogOpen(false);
        }
    }, [formatChangeDisabled]);

    useEffect(() => {
        if (!isFormatDialogOpen) {
            return;
        }

        const timer = window.setTimeout(() => {
            formatSearchInputRef.current?.focus();
            formatSearchInputRef.current?.select();
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [isFormatDialogOpen]);

    useEffect(() => {
        if (!anomalyIsRunning) {
            setAnomalyWindowProgress(null);
            return;
        }

        let cancelled = false;
        let inFlight = false;
        const modelId = anomalyRunningModelId ?? anomalyLastModelId ?? 'bgl';

        const poll = async () => {
            if (inFlight) {
                return;
            }
            inFlight = true;
            try {
                const progress = await getBglAnomalyProgress(modelId);
                if (cancelled) {
                    return;
                }

                if (!progress.running) {
                    setAnomalyWindowProgress({
                        percent: null,
                        processedWindows: 0,
                        totalWindows: 0,
                        processedRows: 0,
                        totalRows: 0,
                        stage: 'starting',
                    });
                    return;
                }

                const safeTotal = Math.max(0, Math.floor(progress.total_windows));
                const safeProcessed = Math.max(0, Math.floor(progress.processed_windows));
                const safeTotalRows = Math.max(0, Math.floor(progress.total_rows));
                const safeProcessedRows = Math.max(0, Math.floor(progress.processed_rows));
                const normalizedPercent = safeTotal > 0
                    ? Math.round((Math.min(safeProcessed, safeTotal) / safeTotal) * 100)
                    : Math.max(0, Math.min(100, Math.round(progress.progress_percent)));

                setAnomalyWindowProgress({
                    percent: normalizedPercent,
                    processedWindows: safeProcessed,
                    totalWindows: safeTotal,
                    processedRows: safeProcessedRows,
                    totalRows: safeTotalRows,
                    stage: progress.stage || 'idle',
                });
            } catch {
                // Keep last known progress if polling fails transiently.
            } finally {
                inFlight = false;
            }
        };

        void poll();
        const timer = window.setInterval(() => {
            void poll();
        }, 1000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [anomalyIsRunning, anomalyLastModelId, anomalyRunningModelId]);

    const anomalyStatus: AnomalyStatusText | null = (() => {
        const allowStatusOnCurrentRoute = anomalyIsRunning || (loaded && isViewLogsRoute);
        if (!allowStatusOnCurrentRoute) {
            return null;
        }

        if (anomalyIsRunning) {
            const progress = anomalyWindowProgress;
            const stage = progress?.stage ?? 'starting';
            const hasVisiblePercent = progress?.percent != null && stage !== 'starting';
            const progressText = hasVisiblePercent
                ? `${Math.max(0, Math.min(100, progress?.percent ?? 0))}%`
                : null;
            const rowsText = progress && progress.totalRows > 0
                ? `${Math.min(progress.processedRows, progress.totalRows)}/${progress.totalRows} строк`
                : 'подготовка строк';
            const windowsText = progress && progress.totalWindows > 0
                ? `${Math.min(progress.processedWindows, progress.totalWindows)}/${progress.totalWindows} окон`
                : 'подготовка окон';
            const stageLabel = stage === 'preprocessing'
                ? 'Идет подготовка данных'
                : stage === 'embedding'
                    ? 'Идет подготовка эмбеддингов'
                    : stage === 'scoring'
                        ? 'Расчет аномалий'
                        : 'Ожидание запуска расчета';
            const stageDetail = stage === 'scoring'
                ? `Обработано ${windowsText}.`
                : stage === 'starting'
                    ? 'Сервер запускает задачу анализа.'
                    : `Обработано ${rowsText}.`;
            const compactText = progressText ? `${stageLabel}: ${progressText}` : `${stageLabel}`;
            const fullText = progressText
                ? `${stageLabel}: ${progressText}. ${stageDetail}`
                : `${stageLabel}. ${stageDetail}`;
            return {
                compact: compactText,
                full: fullText,
                showSpinner: stage === 'starting',
            };
        }

        if (anomalyError) {
            return {
                compact: 'Anomaly: error',
                full: `Anomaly error: ${anomalyError}`,
            };
        }

        if (anomalyIsStopped) {
            const time = anomalyStoppedAt ? new Date(anomalyStoppedAt).toLocaleTimeString() : '';
            return {
                compact: time ? `Anomaly: stopped | ${time}` : 'Anomaly: stopped',
                full: 'Anomaly analysis was stopped by user.',
            };
        }

        if (anomalyLastAnalyzedAt && anomalyLastModelId && anomalyLastRunParams) {
            const ratio = anomalyTotalRows > 0
                ? (anomalyRowsCount / anomalyTotalRows) * 100
                : 0;
            const ratioText = anomalyTotalRows > 0
                ? `${ratio.toFixed(2)}%`
                : '--%';
            const modeLabel = anomalyLastModelId.toUpperCase();
            const threshold = anomalyLastRunParams.threshold;
            const stepSize = anomalyLastRunParams.stepSize;
            const minRegionLines = anomalyLastRunParams.minRegionLines;
            return {
                compact: `Anomaly: ${ratioText}`,
                full: `Anomaly rows: ${anomalyRowsCount} (${ratioText} of ${anomalyTotalRows})`,
                detailsCompact: `${modeLabel} (${threshold}, ${stepSize}, ${minRegionLines})`,
                detailsFull: (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, lineHeight: 1.2 }}>
                        <Typography component="span" variant="body2" sx={{ color: 'inherit' }}>
                            {`Model: ${modeLabel}`}
                        </Typography>
                        <Typography component="span" variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                            Parameters:
                        </Typography>
                        <Typography component="span" variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                            {`Threshold: ${threshold}`}
                        </Typography>
                        <Typography component="span" variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                            {`Step: ${stepSize}`}
                        </Typography>
                        <Typography component="span" variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                            {`Min Region: ${minRegionLines}`}
                        </Typography>
                    </Box>
                ),
            };
        }

        return null;
    })();

    const handleCancelAnomaly = async () => {
        const fallbackModelId = anomalyRunningModelId ?? anomalyLastModelId ?? 'bgl';
        const activeModelId = cancelActiveAnomalyPredictionSession();
        const modelId = activeModelId ?? fallbackModelId;
        dispatch(requestAnomalyCancel());
        try {
            await cancelBglAnomalyPrediction(modelId);
            dispatch(setAnomalyStopped());
        } catch (error) {
            dispatch(setAnomalyError(error instanceof Error ? error.message : 'Не удалось остановить расчет аномалий'));
        } finally {
            dispatch(setAnomalyRunning({ running: false }));
        }
    };

    const handleCancelServerUpload = () => {
        cancelActiveRemoteUploadSession();
        dispatch(setIndexingState({ isIndexing: false, progress: 0 }));
    };

    const formatTooltipTitle = (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, lineHeight: 1.2 }}>
            <Typography component="span" variant="body2" sx={{ color: 'inherit' }}>
                Detected log format type
            </Typography>
            <Typography component="span" variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                Click this field to change format
            </Typography>
        </Box>
    );

    return (
        <Box sx={statusBarSx}>
            <Box sx={statusBarLeftGroupSx}>
                {loaded && (
                    <>
                        <AppStatusBarItem title="Current log file name">
                            <DescriptionIcon sx={iconRaisedSx} />
                            <Typography sx={textSx}>
                                {name}
                            </Typography>
                        </AppStatusBarItem>

                        <Divider
                            orientation="vertical"
                            flexItem
                            sx={statusBarDividerSx}
                        />

                        <AppStatusBarItem title="Total file size on disk">
                            <StorageIcon sx={iconRaisedSx} />
                            <Typography sx={textSx}>
                                {formatFileSize(size)}
                            </Typography>
                        </AppStatusBarItem>

                        <Divider
                            orientation="vertical"
                            flexItem
                            sx={statusBarDividerSx}
                        />

                        {format && (
                            <>
                                <AppStatusBarItem
                                    title={formatTooltipTitle}
                                    onClick={handleFormatDialogOpen}
                                    disabled={formatChangeDisabled}
                                >
                                    <DataObjectIcon sx={statusBarIconSx} />
                                    <Typography sx={textSx}>
                                        {formatDisplayName}
                                    </Typography>
                                </AppStatusBarItem>
                                <Dialog
                                    open={isFormatDialogOpen}
                                    onClose={handleFormatDialogClose}
                                    maxWidth="sm"
                                    fullWidth
                                    PaperProps={{
                                        sx: {
                                            maxWidth: 520,
                                        },
                                    }}
                                >
                                    <DialogTitle sx={{ pr: 6 }}>
                                        Выбор формата логов
                                        <IconButton
                                            aria-label="close"
                                            onClick={handleFormatDialogClose}
                                            size="small"
                                            sx={{ position: 'absolute', right: 8, top: 8 }}
                                        >
                                            <CloseIcon fontSize="small" />
                                        </IconButton>
                                    </DialogTitle>
                                    <DialogContent sx={{ pt: 1 }}>
                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                                            Выберите формат для корректного парсинга и отображения полей в таблице.
                                        </Typography>
                                        <TextField
                                            autoFocus
                                            inputRef={formatSearchInputRef}
                                            fullWidth
                                            size="small"
                                            label="Поиск формата"
                                            placeholder="Введите название формата"
                                            value={formatSearchQuery}
                                            onChange={(event) => setFormatSearchQuery(event.target.value)}
                                            sx={{ mb: 1.5 }}
                                        />
                                        <List sx={{ py: 0, maxHeight: 360, overflowY: 'auto' }}>
                                            {filteredFormatOptions.map((formatOption) => (
                                                <ListItemButton
                                                    key={formatOption.id}
                                                    selected={formatOption.id === normalizedFormatId}
                                                    onClick={() => handleFormatSelect(formatOption.id)}
                                                >
                                                    <ListItemText
                                                        primary={formatOption.name}
                                                        secondary={formatOption.id === normalizedFormatId ? 'Текущий формат' : undefined}
                                                    />
                                                </ListItemButton>
                                            ))}
                                            {filteredFormatOptions.length === 0 && (
                                                <ListItemText
                                                    primary="Форматы не найдены"
                                                    primaryTypographyProps={{ color: 'text.secondary', sx: { px: 2, py: 1 } }}
                                                />
                                            )}
                                        </List>
                                    </DialogContent>
                                    <DialogActions sx={{ px: 3, pb: 2 }}>
                                        <Button onClick={handleFormatDialogClose} variant="outlined">
                                            Закрыть
                                        </Button>
                                    </DialogActions>
                                </Dialog>
                            </>
                        )}

                    </>
                )}
            </Box>
            <Box sx={statusBarRightGroupSx}>
                {isIndexing && (
                    <>
                        <AppStatusBarItem
                            title={isServerUploadInProgress
                                ? `Идет загрузка на сервер ${indexingProgress}%`
                                : `Indexing ${indexingProgress}%`
                            }
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    minWidth: 180,
                                }}
                            >
                                <Typography sx={anomalyTextSx}>
                                    {isServerUploadInProgress
                                        ? `Идет загрузка на сервер ${indexingProgress}%`
                                        : `Indexing ${indexingProgress}%`
                                    }
                                </Typography>
                                <LinearProgress
                                    variant="determinate"
                                    value={Math.max(0, Math.min(indexingProgress, 100))}
                                    sx={{
                                        width: 120,
                                        height: 6,
                                        borderRadius: 3,
                                    }}
                                />
                            </Box>
                        </AppStatusBarItem>
                        {isServerUploadInProgress && (
                            <>
                                <Divider
                                    orientation="vertical"
                                    flexItem
                                    sx={statusBarDividerSx}
                                />
                                <AppStatusBarItem
                                    title="Отменить загрузку на сервер"
                                    onClick={handleCancelServerUpload}
                                >
                                    <CloseIcon sx={closeButtonSx} />
                                </AppStatusBarItem>
                            </>
                        )}
                    </>
                )}
                {anomalyStatus && (
                    <>
                        <AppStatusBarItem title={anomalyStatus.full}>
                            {anomalyStatus.showSpinner && (
                                <CircularProgress
                                    size={12}
                                    thickness={6}
                                    sx={{ color: 'inherit', opacity: 0.85 }}
                                />
                            )}
                            <Typography sx={anomalyTextSx}>
                                {anomalyStatus.compact}
                            </Typography>
                        </AppStatusBarItem>
                        {anomalyStatus.detailsCompact && (
                            <>
                                <Divider
                                    orientation="vertical"
                                    flexItem
                                    sx={statusBarDividerSx}
                                />
                                <AppStatusBarItem title={anomalyStatus.detailsFull ?? anomalyStatus.detailsCompact}>
                                    <Typography sx={anomalyTextSx}>
                                        {anomalyStatus.detailsCompact}
                                    </Typography>
                                </AppStatusBarItem>
                            </>
                        )}
                        {anomalyIsRunning && (
                            <>
                                <Divider
                                    orientation="vertical"
                                    flexItem
                                    sx={statusBarDividerSx}
                                />
                                <AppStatusBarItem
                                    title="Остановить расчет аномалий"
                                    onClick={() => void handleCancelAnomaly()}
                                >
                                    <CloseIcon sx={closeButtonSx} />
                                </AppStatusBarItem>
                            </>
                        )}
                    </>
                )}
            </Box>
        </Box>
    );
};

export default AppStatusBar;
