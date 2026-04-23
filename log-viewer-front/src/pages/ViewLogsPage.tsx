import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { FileSelectionView } from '../components/FileSelectionView';
import LogLinesList from '../components/LogLinesList';
import LogToolbar from '../components/LogToolbar';
import AddLogFormatDialog from '../components/log-patterns/AddLogFormatDialog';
import LogViewHistogramPanel from './viewLogs/components/LogViewHistogramPanel';
import LogViewMonitoringBanner from './viewLogs/components/LogViewMonitoringBanner';
import FormatChangeConfirmDialog from './viewLogs/components/FormatChangeConfirmDialog';
import UnknownFormatConfirmDialog from './viewLogs/components/UnknownFormatConfirmDialog';
import ConfirmActionDialog from '../components/common/ConfirmActionDialog';
import { useViewLogsController } from './viewLogs/useViewLogsController';
import { useTranslation } from 'react-i18next';

const ViewLogsPage: React.FC = () => {
    const { t } = useTranslation();
    const {
        fileSelection,
        monitoringBanner,
        tableServerConnectionState,
        isTableFilteringRows,
        histogram,
        toolbarProps,
        listProps,
        showEmptyFilteredState,
        formatChangeDialog,
        monitoringReplaceDialog,
        confirmDialog,
        customFormatDialog,
    } = useViewLogsController();

    const showTablePreparing = histogram.isLargeFile
        && toolbarProps.isStreamView
        && toolbarProps.totalRowsHintForAnomaly === 0;

    const showTableRowsLoading = !showTablePreparing
        && isTableFilteringRows
        && (listProps.totalCount ?? 0) === 0;

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
                loadingMessage={t('viewLogs.histogram.loadingMessage')}
                parsedLines={histogram.parsedLines}
                anomalyRegions={histogram.anomalyRegions}
                onAnomalyRangeSelect={histogram.onAnomalyRangeSelect}
                onTimeRangeChange={histogram.onTimeRangeChange}
                selectedTimeRange={histogram.selectedTimeRange}
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
                            {t('viewLogs.table.preparingLargeFile')}
                        </Typography>
                    </Box>
                ) : showTableRowsLoading ? (
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
                            {t('viewLogs.table.loadingRows')}
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
                            {t('viewLogs.table.emptyFiltered')}
                        </Typography>
                    </Box>
                ) : (
                    <LogLinesList {...listProps} />
                )}
            </Box>

            <UnknownFormatConfirmDialog
                open={confirmDialog.open}
                fileName={confirmDialog.fileName}
                fileSize={confirmDialog.fileSize}
                previewText={confirmDialog.previewText}
                onConfirm={confirmDialog.onConfirm}
                onCancel={confirmDialog.onCancel}
            />

            <FormatChangeConfirmDialog
                open={formatChangeDialog.open}
                message={formatChangeDialog.message}
                onConfirm={formatChangeDialog.onConfirm}
                onCancel={formatChangeDialog.onCancel}
            />

            <ConfirmActionDialog
                open={monitoringReplaceDialog.open}
                message={monitoringReplaceDialog.message}
                onConfirm={monitoringReplaceDialog.onConfirm}
                onCancel={monitoringReplaceDialog.onCancel}
            />

            <AddLogFormatDialog
                open={customFormatDialog.open}
                onClose={customFormatDialog.onClose}
                onSubmit={customFormatDialog.onSubmit}
                previewLines={customFormatDialog.previewLines}
                title={t('viewLogs.customFormatDialog.title')}
                submitLabel={t('viewLogs.customFormatDialog.submit')}
            />
        </Box>
    );
};

export default ViewLogsPage;