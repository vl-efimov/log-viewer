import Box from '@mui/material/Box';
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
        histogram,
        toolbarProps,
        listProps,
    } = useViewLogsController();

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
                    message="Для отслеживания новых строк выберите тот же файл снова."
                    actionLabel="Выбрать файл для мониторинга"
                    onAction={() => void monitoringBanner.onReattach()}
                />
            )}

            <LogViewHistogramPanel
                isLargeFile={histogram.isLargeFile}
                isIndexing={histogram.isIndexing}
                isHistogramLoading={histogram.isHistogramLoading}
                loadingMessage="Индексация завершится — появится график."
                parsedLines={histogram.parsedLines}
                anomalyRegions={histogram.anomalyRegions}
                anomalyLineNumbers={histogram.anomalyLineNumbers}
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
                <LogLinesList {...listProps} />
            </Box>
        </Box>
    );
};

export default ViewLogsPage;