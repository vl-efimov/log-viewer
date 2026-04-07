import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
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
import { cancelBglAnomalyPrediction } from '../../../services/bglAnomalyApi';
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
    } = useSelector((state: RootState) => state.logFile);
    const {
        rowsCount: anomalyRowsCount,
        error: anomalyError,
        isStopped: anomalyIsStopped,
        stoppedAt: anomalyStoppedAt,
        lastAnalyzedAt: anomalyLastAnalyzedAt,
        lastModelId: anomalyLastModelId,
        isRunning: anomalyIsRunning,
        runningModelId: anomalyRunningModelId,
        runStartedAt: anomalyRunStartedAt,
        expectedDurationSec: anomalyExpectedDurationSec,
        lastRunParams: anomalyLastRunParams,
    } = useSelector((state: RootState) => state.anomaly);
    const [nowMs, setNowMs] = useState<number>(() => Date.now());

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

    useEffect(() => {
        if (!anomalyIsRunning) {
            return;
        }

        const timer = window.setInterval(() => {
            setNowMs(Date.now());
        }, 1000);

        return () => {
            window.clearInterval(timer);
        };
    }, [anomalyIsRunning]);

    const formatDuration = (seconds: number): string => {
        const safe = Math.max(0, Math.floor(seconds));
        const hh = Math.floor(safe / 3600);
        const mm = Math.floor((safe % 3600) / 60);
        const ss = safe % 60;
        if (hh > 0) {
            return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
        return `${mm}:${String(ss).padStart(2, '0')}`;
    };

    const anomalyStatus = (() => {
        if (!loaded || !isViewLogsRoute) {
            return null;
        }

        if (anomalyIsRunning) {
            const elapsedSec = anomalyRunStartedAt ? Math.max(0, Math.floor((nowMs - anomalyRunStartedAt) / 1000)) : 0;
            const expected = anomalyExpectedDurationSec;
            const remainingSec = expected != null ? Math.max(0, expected - elapsedSec) : null;
            return {
                compact: expected != null
                    ? `Anomaly: ${formatDuration(elapsedSec)} / ${formatDuration(remainingSec ?? 0)}`
                    : `Anomaly: ${formatDuration(elapsedSec)} / --:--`,
                full: expected
                    ? `Anomaly analysis in progress. Elapsed ${formatDuration(elapsedSec)}, remaining about ${formatDuration(remainingSec ?? 0)}.`
                    : `Anomaly analysis in progress. Elapsed ${formatDuration(elapsedSec)}. Remaining time is not available yet.`,
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
            return {
                compact: `Anomaly: ${anomalyRowsCount} | ${time} ${anomalyLastModelId.toUpperCase()} | th ${anomalyLastRunParams.threshold} s ${anomalyLastRunParams.stepSize} r ${anomalyLastRunParams.minRegionLines}`,
                full: `Anomaly rows: ${anomalyRowsCount} | Last analysis: ${time} (${anomalyLastModelId.toUpperCase()}) | Params: threshold=${anomalyLastRunParams.threshold}, step=${anomalyLastRunParams.stepSize}, minRegion=${anomalyLastRunParams.minRegionLines}`,
            };
        }

        return null;
    })();

    const handleCancelAnomaly = async () => {
        const modelId = anomalyRunningModelId ?? anomalyLastModelId ?? 'bgl';
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

                        {/* {lastUpdate && (
                            <Typography variant="caption" color="text.secondary">
                                Last updated: {lastUpdate.toLocaleTimeString()}
                            </Typography>
                        )} */}
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
                        title={`Indexing ${indexingProgress}%`}
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
                                Indexing {indexingProgress}%
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
