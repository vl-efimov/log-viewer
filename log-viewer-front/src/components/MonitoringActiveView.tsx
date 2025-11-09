import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface MonitoringActiveViewProps {
    fileName: string;
    onViewLogs: () => void;
    onStopMonitoring: () => void;
}

export const MonitoringActiveView: React.FC<MonitoringActiveViewProps> = ({
    fileName,
    onViewLogs,
    onStopMonitoring,
}) => {
    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                height: '100%',
                width: '100%',
            }}
        >
            <CheckCircleIcon sx={{ fontSize: 80, color: 'success.main' }} />
            <Typography variant="h4" gutterBottom>
                Monitoring Active
            </Typography>
            <Typography
                variant="body1"
                sx={{
                    maxWidth: 500,
                    textAlign: 'center',
                }}
            >
                File: <strong>{fileName}</strong>
                <br />
                The file is being monitored for changes. Edit it in your text editor to see live updates.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                    variant="contained"
                    onClick={onViewLogs}
                    size="large"
                >
                    View Logs
                </Button>
                <Button
                    variant="outlined"
                    onClick={onStopMonitoring}
                    size="large"
                    color="error"
                >
                    Stop Monitoring
                </Button>
            </Box>
        </Box>
    );
};
