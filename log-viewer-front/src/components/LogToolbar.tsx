import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

interface LogToolbarProps {
    fileName: string;
    lastUpdate: Date | null;
    onReloadFile: () => void;
    onManualRefresh: () => void;
    onScrollToBottom: () => void;
    autoRefresh: boolean;
    onToggleAutoRefresh: () => void;
    parsedLinesCount: number;
    filterStats: { filtered: number; total: number; parsedFiltered: number };
    contentSize: number;
    fileSize: number;
    newLinesCount: number;
}

const LogToolbar: React.FC<LogToolbarProps> = ({
    fileName,
    lastUpdate,
    onReloadFile,
    onManualRefresh,
    onScrollToBottom,
    autoRefresh,
    onToggleAutoRefresh,
    parsedLinesCount,
    filterStats,
    contentSize,
    fileSize,
    newLinesCount,
}) => {
    return (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box>
                    <Typography variant="h6">
                        {fileName}
                    </Typography>
                    {lastUpdate && (
                        <Typography variant="caption" color="text.secondary">
                            Last updated: {lastUpdate.toLocaleTimeString()}
                        </Typography>
                    )}
                </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={onReloadFile}
                >
                    Change File
                </Typography>
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={onManualRefresh}
                >
                    Refresh Now
                </Typography>
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={onScrollToBottom}
                >
                    Jump to End
                </Typography>
                <Chip
                    label={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                    color={autoRefresh ? 'success' : 'default'}
                    onClick={onToggleAutoRefresh}
                    size="small"
                    sx={{ cursor: 'pointer' }}
                />
                <Typography variant="caption" color="text.secondary">
                    Total lines: {parsedLinesCount}
                    {filterStats.filtered !== filterStats.total && (
                        <> | Showing: {filterStats.filtered} ({filterStats.parsedFiltered} parsed + stacktraces)</>
                    )}
                    {' | '}Content size: {contentSize.toLocaleString()} bytes | File size: {fileSize.toLocaleString()} bytes
                </Typography>
                {newLinesCount > 0 && (
                    <Chip
                        label={`+${newLinesCount} new`}
                        color="success"
                        size="small"
                        variant="outlined"
                        sx={{
                            animation: 'pulse 0.5s ease-in-out',
                            '@keyframes pulse': {
                                '0%': { transform: 'scale(1)' },
                                '50%': { transform: 'scale(1.1)' },
                                '100%': { transform: 'scale(1)' },
                            }
                        }}
                    />
                )}
            </Box>
        </>
    );
};

export default LogToolbar;
