import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const NotFoundPage: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                overflow: 'hidden',
            }}
        >
            <Box
                sx={{
                    width: '100%',
                    maxWidth: 620,
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
                        background: 'linear-gradient(90deg, #06b6d4 0%, #3b82f6 45%, #10b981 100%)',
                    },
                }}
            >
                <Typography
                    variant="h1"
                    sx={{
                        fontSize: { xs: '3.25rem', sm: '4rem' },
                        lineHeight: 1,
                        mb: 1,
                        fontWeight: 800,
                        letterSpacing: '0.03em',
                        color: 'primary.main',
                    }}
                >
                    404
                </Typography>
                <Typography variant="h4" sx={{ mb: 1.5, fontWeight: 700 }}>
                    {t('notFound.title')}
                </Typography>
                <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{ maxWidth: 460, mx: 'auto', mb: 4 }}
                >
                    {t('notFound.description')}
                </Typography>
                <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    startIcon={<HomeRoundedIcon />}
                    onClick={() => navigate('/')}
                    sx={{ px: 3.5 }}
                >
                    {t('notFound.goHome')}
                </Button>
            </Box>
        </Box>
    );
};

export default NotFoundPage;