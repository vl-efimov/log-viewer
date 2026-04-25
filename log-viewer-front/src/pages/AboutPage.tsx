import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { ColorModeEnum } from '../constants/ColorModeEnum';

const AboutPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const theme = useTheme();

    const isDarkTheme = theme.palette.mode === ColorModeEnum.Dark;
    const logoSrc = `${import.meta.env.BASE_URL}${isDarkTheme ? 'luvo-logo-alt-minimal.svg' : 'luvo-logo-alt-minimal-dark.svg'}`;
    const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en').toLowerCase();
    const isCzechLanguage = language.startsWith('cs') || language.startsWith('cz');
    const cvutLogoSrc = isCzechLanguage
        ? `${import.meta.env.BASE_URL}fit-cvut-logo-cs.svg`
        : `${import.meta.env.BASE_URL}fit-cvut-logo-en.svg`;

    return (
        <Box
            sx={{
                width: '100%',
                display: 'grid',
                gap: 2,
            }}
        >
            <Paper
                elevation={0}
                sx={{
                    p: { xs: 2, sm: 3 },
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    backgroundColor: 'background.paper',
                }}
            >
                <Box sx={{ maxWidth: 980 }}>
                    <Box
                        component="img"
                        src={logoSrc}
                        alt={t('aboutPage.logoAlt')}
                        sx={{
                            display: 'block',
                            width: '100%',
                            maxWidth: { xs: 320, sm: 520 },
                            height: 'auto',
                            mb: 2.5,
                        }}
                    />

                    <Typography variant="body1" sx={{ mb: 2 }}>
                        {t('aboutPage.description')}
                    </Typography>

                    <Box component="ul" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.75 }}>
                        <Box component="li">{t('aboutPage.highlights.viewer')}</Box>
                        <Box component="li">{t('aboutPage.highlights.monitoring')}</Box>
                        <Box component="li">{t('aboutPage.highlights.charts')}</Box>
                        <Box component="li">{t('aboutPage.highlights.anomaly')}</Box>
                    </Box>

                    <Typography variant="body2" sx={{ mt: 2 }}>
                        {t('aboutPage.thesisAttribution')}
                    </Typography>
                </Box>
            </Paper>

            <Paper
                elevation={0}
                sx={{
                    p: { xs: 2, sm: 3 },
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    backgroundColor: 'background.paper',
                }}
            >
                <Box
                    sx={{
                        maxWidth: 980,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 1.5,
                    }}
                >
                    <Box
                        component="img"
                        src={cvutLogoSrc}
                        alt={t('aboutPage.thesis.cvutLogoAlt')}
                        sx={{
                            display: 'block',
                            width: { xs: 180, sm: 260 },
                            height: 'auto',
                        }}
                    />

                    <Box sx={{ maxWidth: 560 }}>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            {t('aboutPage.thesis.supportLine1')}
                        </Typography>

                        <Typography variant="body2">
                            {t('aboutPage.thesis.supportLine2Prefix')}{' '}
                            <Link
                                href="https://fit.cvut.cz"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                fit.cvut.cz
                            </Link>
                            .
                        </Typography>
                    </Box>
                </Box>
            </Paper>
        </Box>
    );
};

export default AboutPage;
