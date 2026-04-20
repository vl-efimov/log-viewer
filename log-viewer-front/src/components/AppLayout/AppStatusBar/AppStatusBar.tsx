import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import DescriptionIcon from '@mui/icons-material/Description';
import CloseIcon from '@mui/icons-material/Close';
import StorageIcon from '@mui/icons-material/Storage';
import DataObjectIcon from '@mui/icons-material/DataObject';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { RootState } from '../../../redux/store';
import { baseUrl } from '../../../constants/BaseUrl';
import { RouteViewLogs } from '../../../routes/routePaths';
import { requestAnomalyCancel, setAnomalyError, setAnomalyRunning, setAnomalyStopped } from '../../../redux/slices/anomalySlice';
import { cancelActiveAnomalyPredictionSession, cancelBglAnomalyPrediction, getBglAnomalyProgress } from '../../../services/bglAnomalyApi';
import AppStatusBarItem from '../AppStatusBarItem';
import {
    anomalyTextSx,
    closeButtonSx,
    statusBarDividerSx,
    iconRaisedSx,
    statusBarIconSx,
    statusBarLeftGroupSx,
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
            const time = new Date(anomalyLastAnalyzedAt).toLocaleTimeString();
            const ratio = anomalyTotalRows > 0
                ? (anomalyRowsCount / anomalyTotalRows) * 100
                : 0;
            const ratioText = anomalyTotalRows > 0
                ? `${ratio.toFixed(2)}%`
                : '--%';
            return {
                compact: `Anomaly: ${anomalyRowsCount} (${ratioText}) | ${time} ${anomalyLastModelId.toUpperCase()} | th ${anomalyLastRunParams.threshold} s ${anomalyLastRunParams.stepSize} r ${anomalyLastRunParams.minRegionLines}`,
                full: `Anomaly rows: ${anomalyRowsCount} (${ratioText} of ${anomalyTotalRows}) | Last analysis: ${time} (${anomalyLastModelId.toUpperCase()}) | Params: threshold=${anomalyLastRunParams.threshold}, step=${anomalyLastRunParams.stepSize}, minRegion=${anomalyLastRunParams.minRegionLines}`,
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
                            <AppStatusBarItem title="Detected log format type">
                                <DataObjectIcon sx={statusBarIconSx} />
                                <Typography sx={textSx}>
                                    {format}
                                </Typography>
                            </AppStatusBarItem>
                        )}

                    </>
                )}
            </Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                }}
            >
                {isIndexing && (
                    <Tooltip
                        title={isServerUploadInProgress
                            ? `Идет загрузка на сервер ${indexingProgress}%`
                            : `Indexing ${indexingProgress}%`
                        }
                        arrow
                        placement="top"
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
                    </Tooltip>
                )}
                {anomalyStatus && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {anomalyStatus.showSpinner && (
                            <CircularProgress
                                size={12}
                                thickness={6}
                                sx={{ color: 'inherit', opacity: 0.85 }}
                            />
                        )}
                        <Tooltip
                            title={anomalyStatus.full}
                            arrow
                            placement="top"
                        >
                            <Typography sx={anomalyTextSx}>
                                {anomalyStatus.compact}
                            </Typography>
                        </Tooltip>
                        {anomalyIsRunning && (
                            <Tooltip
                                title="Остановить расчет аномалий"
                                arrow
                                placement="top"
                            >
                                <IconButton
                                    size="small"
                                    sx={closeButtonSx}
                                    onClick={() => void handleCancelAnomaly()}
                                >
                                    <CloseIcon fontSize="inherit" />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default AppStatusBar;
