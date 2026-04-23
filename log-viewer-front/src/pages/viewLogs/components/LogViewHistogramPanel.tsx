import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { FC } from 'react';
import { LogHistogram } from '../../../components/LogHistogram';
import type { ParsedLogLine } from '../../../utils/logFormatDetector';

interface LogViewHistogramPanelProps {
    isLargeFile: boolean;
    isIndexing: boolean;
    isHistogramLoading: boolean;
    loadingMessage: string;
    parsedLines: Array<{
        lineNumber: number;
        parsed: ParsedLogLine | null;
        raw: string;
        error?: string;
    }>;
    anomalyRegions?: Array<{
        start_line: number;
        end_line: number;
        start_timestamp: string | null;
        end_timestamp: string | null;
    }>;
    anomalyLineNumbers?: number[];
    onAnomalyRangeSelect?: (startLine: number, endLine: number) => void;
    onTimeRangeChange?: (startTime: number | null, endTime: number | null) => void;
    selectedTimeRange?: { start: number | null; end: number | null };
}

const LogViewHistogramPanel: FC<LogViewHistogramPanelProps> = ({
    isLargeFile,
    isIndexing,
    isHistogramLoading,
    loadingMessage,
    parsedLines,
    anomalyRegions,
    anomalyLineNumbers,
    onAnomalyRangeSelect,
    onTimeRangeChange,
    selectedTimeRange,
}) => {
    const showLoading = (isIndexing || isHistogramLoading) && !isLargeFile;

    if (showLoading) {
        return (
            <Box
                sx={{
                    height: 150,
                    borderRadius: 1,
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    backgroundColor: (theme) => theme.palette.background.paper,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    px: 2,
                }}
            >
                <CircularProgress size={24} />
                <Typography
                    variant="body2"
                    color="text.secondary"
                >
                    {loadingMessage}
                </Typography>
            </Box>
        );
    }

    if (!isIndexing && !isHistogramLoading && parsedLines.length > 0) {
        return (
            <LogHistogram
                parsedLines={parsedLines}
                defaultCollapsed={false}
                height={150}
                anomalyRegions={anomalyRegions}
                anomalyLineNumbers={anomalyLineNumbers}
                onAnomalyRangeSelect={onAnomalyRangeSelect}
                onTimeRangeChange={onTimeRangeChange}
                selectedTimeRange={selectedTimeRange}
                showQuickRangeButtons={false}
            />
        );
    }

    return null;
};

export default LogViewHistogramPanel;
