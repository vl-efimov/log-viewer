import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { Trans, useTranslation } from 'react-i18next';

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
    const { t } = useTranslation();

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
            <Typography
                variant="h4"
                gutterBottom
            >
                {t('monitoringActive.title')}
            </Typography>
            <Typography
                variant="body1"
                sx={{
                    maxWidth: 500,
                    textAlign: 'center',
                }}
            >
                <Trans
                    i18nKey="monitoringActive.fileLabel"
                    values={{ fileName }}
                    components={{ strong: <strong /> }}
                />
                <br />
                {t('monitoringActive.description')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                    variant="contained"
                    onClick={onViewLogs}
                    size="large"
                >
                    {t('monitoringActive.viewLogs')}
                </Button>
                <Button
                    variant="outlined"
                    onClick={onStopMonitoring}
                    size="large"
                    color="error"
                >
                    {t('monitoringActive.stop')}
                </Button>
            </Box>
        </Box>
    );
};
