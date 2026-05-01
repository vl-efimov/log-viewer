import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { alpha } from '@mui/material/styles';
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
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                width: '100%',
                overflow: 'hidden',
                px: { xs: 2, sm: 3 },
                py: { xs: 3, sm: 4 },
            }}
        >
            <Box
                sx={{
                    width: '100%',
                    maxWidth: 680,
                    px: { xs: 3, sm: 5 },
                    py: { xs: 5, sm: 6 },
                    borderRadius: 4,
                    textAlign: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    background: (theme) =>
                        theme.palette.mode === 'light'
                            ? 'linear-gradient(165deg, rgba(255,255,255,0.96) 0%, rgba(238,246,255,0.92) 100%)'
                            : 'linear-gradient(165deg, rgba(15,23,42,0.88) 0%, rgba(30,41,59,0.9) 100%)',
                    boxShadow: (theme) =>
                        theme.palette.mode === 'light'
                            ? '0 18px 45px rgba(15, 23, 42, 0.12)'
                            : '0 20px 50px rgba(2, 6, 23, 0.5)',
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 4,
                        background: 'linear-gradient(90deg, #10b981 0%, #22c55e 35%, #06b6d4 100%)',
                    },
                }}
            >
                <Box
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 72,
                        height: 72,
                        borderRadius: '20px',
                        mb: 3,
                        color: 'success.main',
                        backgroundColor: (theme) => alpha(theme.palette.success.main, theme.palette.mode === 'light' ? 0.12 : 0.2),
                        boxShadow: (theme) => `inset 0 0 0 1px ${alpha(theme.palette.success.main, 0.18)}`,
                    }}
                >
                    <CheckCircleIcon sx={{ fontSize: 34 }} />
                </Box>
                <Typography
                    variant="h4"
                    sx={{ mb: 1.5, fontWeight: 700 }}
                >
                    {t('monitoringActive.title')}
                </Typography>
                <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{
                        maxWidth: 540,
                        mx: 'auto',
                        mb: 4,
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
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: 2,
                        flexWrap: 'wrap',
                    }}
                >
                    <Button
                        variant="contained"
                        onClick={onViewLogs}
                        size="large"
                        sx={{ px: 3.5, py: 1.2, borderRadius: 2.5, fontWeight: 700 }}
                    >
                        {t('monitoringActive.viewLogs')}
                    </Button>
                    <Button
                        variant="outlined"
                        onClick={onStopMonitoring}
                        size="large"
                        color="error"
                        sx={{ px: 3.5, py: 1.2, borderRadius: 2.5, fontWeight: 700 }}
                    >
                        {t('monitoringActive.stop')}
                    </Button>
                </Box>
            </Box>
        </Box>
    );
};
