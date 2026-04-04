import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import DescriptionIcon from '@mui/icons-material/Description';
import StorageIcon from '@mui/icons-material/Storage';
import DataObjectIcon from '@mui/icons-material/DataObject';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { RootState } from '../../../redux/store';
import { baseUrl } from '../../../constants/BaseUrl';
import { RouteViewLogs } from '../../../routes/routePaths';
import AppStatusBarItem from '../AppStatusBarItem';
import {
    anomalyTextSx,
    statusBarDividerSx,
    iconRaisedSx,
    statusBarIconSx,
    statusBarLeftGroupSx,
    statusBarSx,
    textSx,
} from './styles';

const AppStatusBar: React.FC = () => {
    const location = useLocation();
    const {
        name,
        size,
        format,
        loaded,
        anomalyRowsCount,
        anomalyError,
        anomalyLastAnalyzedAt,
        anomalyLastModelId,
        anomalyIsRunning,
        anomalyRunStartedAt,
        anomalyExpectedDurationSec,
        anomalyLastRunParams,
    } = useSelector((state: RootState) => state.logFile);
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

        if (anomalyLastAnalyzedAt && anomalyLastModelId && anomalyLastRunParams) {
            const time = new Date(anomalyLastAnalyzedAt).toLocaleTimeString();
            return {
                compact: `Anomaly: ${anomalyRowsCount} | ${time} ${anomalyLastModelId.toUpperCase()} | th ${anomalyLastRunParams.threshold} s ${anomalyLastRunParams.stepSize} r ${anomalyLastRunParams.minRegionLines}`,
                full: `Anomaly rows: ${anomalyRowsCount} | Last analysis: ${time} (${anomalyLastModelId.toUpperCase()}) | Params: threshold=${anomalyLastRunParams.threshold}, step=${anomalyLastRunParams.stepSize}, minRegion=${anomalyLastRunParams.minRegionLines}`,
            };
        }

        return null;
    })();

    return (
        <Box sx={statusBarSx}>
            <Box
                sx={statusBarLeftGroupSx}
            >
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
                {anomalyStatus && (
                    <Tooltip title={anomalyStatus.full} arrow placement="top">
                        <Typography sx={anomalyTextSx}>
                            {anomalyStatus.compact}
                        </Typography>
                    </Tooltip>
                )}
            </Box>
        </Box>
    );
};

export default AppStatusBar;
