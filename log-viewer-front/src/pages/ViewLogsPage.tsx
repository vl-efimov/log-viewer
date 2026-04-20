import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { FileSelectionView } from '../components/FileSelectionView';
import LogLinesList from '../components/LogLinesList';
import LogToolbar from '../components/LogToolbar';
import LogViewHistogramPanel from './viewLogs/components/LogViewHistogramPanel';
import LogViewMonitoringBanner from './viewLogs/components/LogViewMonitoringBanner';
import { useViewLogsController } from './viewLogs/useViewLogsController';

const ViewLogsPage: React.FC = () => {
    const {
        fileSelection,
        monitoringBanner,
        tableServerConnectionState,
        histogram,
        toolbarProps,
        listProps,
        showEmptyFilteredState,
    } = useViewLogsController();

    const showTablePreparing = histogram.isLargeFile
        && toolbarProps.isStreamView
        && toolbarProps.totalRowsHintForAnomaly === 0;

    if (fileSelection.show) {
        return (
            <FileSelectionView
                indexing={fileSelection.indexing}
                onFileSelect={fileSelection.onFileSelect}
                onFileInputChange={fileSelection.onFileInputChange}
            />
        );
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                overflow: 'hidden',
            }}
        >
            {monitoringBanner.show && (
                <LogViewMonitoringBanner
                    message={monitoringBanner.message}
                    actionLabel={monitoringBanner.actionLabel}
                    onAction={monitoringBanner.onAction}
                />
            )}

            <LogViewHistogramPanel
                isLargeFile={histogram.isLargeFile}
                isIndexing={histogram.isIndexing}
                isHistogramLoading={histogram.isHistogramLoading}
                loadingMessage="Индексация завершится — появится график."
                parsedLines={histogram.parsedLines}
                anomalyRegions={histogram.anomalyRegions}
                onAnomalyRangeSelect={histogram.onAnomalyRangeSelect}
            />

            <LogToolbar {...toolbarProps} />

            <Box
                sx={{
                    flexGrow: 1,
                    flexShrink: 1,
                    minHeight: 0,
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#fafafa',
                    borderRadius: 1,
                    overflow: 'hidden',
                }}
            >
                {tableServerConnectionState.show ? (
                    <Box
                        sx={{
                            height: '100%',
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            px: 2,
                        }}
                    >
                        <CircularProgress size={26} />
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            align="center"
                        >
                            {tableServerConnectionState.message}
                        </Typography>
                    </Box>
                ) : showTablePreparing ? (
                    <Box
                        sx={{
                            height: '100%',
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            px: 2,
                        }}
                    >
                        <CircularProgress size={26} />
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            align="center"
                        >
                            Подготавливаем таблицу для большого файла. Это может занять некоторое время.
                        </Typography>
                    </Box>
                ) : showEmptyFilteredState ? (
                    <Box
                        sx={{
                            height: '100%',
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            px: 2,
                        }}
                    >
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            align="center"
                        >
                            По выбранным фильтрам ничего не найдено.
                        </Typography>
                    </Box>
                ) : (
                    <LogLinesList {...listProps} />
                )}
            </Box>
        </Box>
    );
};

export default ViewLogsPage;