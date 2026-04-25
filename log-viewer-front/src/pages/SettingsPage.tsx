import { useContext, useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useTranslation } from 'react-i18next';
import Flag from '../components/common/Flag';
import { ThemeContext } from '../contexts/ThemeContext';
import { ColorModeEnum } from '../constants/ColorModeEnum';
import { Languages } from '../constants/LanguagesEnum';

const PRIMARY_COLORS = [
    '#334155',
    '#10b981',
    '#22c55e',
    '#84cc16',
    '#f97316',
    '#ff9800',
    '#f59e0b',
    '#eab308',
    '#14b8a6',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#ec4899',
    '#f43f5e',
];

const LANGUAGE_OPTIONS = [Languages.EN, Languages.RU, Languages.CZ];

const resolveLanguage = (lang: string): Languages => {
    const normalized = lang.toLowerCase();

    if (normalized.startsWith('ru')) {
        return Languages.RU;
    }

    if (normalized.startsWith('cs') || normalized.startsWith('cz')) {
        return Languages.CZ;
    }

    return Languages.EN;
};

const SettingsPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const themeCtx = useContext(ThemeContext);

    if (!themeCtx) {
        return null;
    }

    const { mode, toggleTheme, primaryColor, setPrimaryColor } = themeCtx;
    const selectedLanguage = useMemo(
        () => resolveLanguage(i18n.resolvedLanguage ?? i18n.language ?? Languages.EN),
        [i18n.language, i18n.resolvedLanguage]
    );

    const setMode = (targetMode: ColorModeEnum) => {
        if (mode !== targetMode) {
            toggleTheme();
        }
    };

    return (
        <Box
            sx={{
                width: '100%',
                display: 'grid',
                gap: 2,
            }}
        >
            <Typography variant="h5">{t('settings.title')}</Typography>

            <Paper
                elevation={0}
                sx={{
                    p: { xs: 2, sm: 3 },
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                }}
            >
                <Box sx={{ maxWidth: 980 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                        {t('theme.mode')}
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        <Button
                            onClick={() => setMode(ColorModeEnum.Light)}
                            variant={mode === ColorModeEnum.Light ? 'contained' : 'outlined'}
                            startIcon={<LightModeIcon />}
                        >
                            {t('theme.light')}
                        </Button>
                        <Button
                            onClick={() => setMode(ColorModeEnum.Dark)}
                            variant={mode === ColorModeEnum.Dark ? 'contained' : 'outlined'}
                            startIcon={<DarkModeIcon />}
                        >
                            {t('theme.dark')}
                        </Button>
                    </Stack>
                </Box>
            </Paper>

            <Paper
                elevation={0}
                sx={{
                    p: { xs: 2, sm: 3 },
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                }}
            >
                <Box sx={{ maxWidth: 980 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                        {t('theme.primaryColor')}
                    </Typography>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(44px, 44px))',
                            gap: 1,
                        }}
                    >
                        {PRIMARY_COLORS.map((color) => (
                            <Box
                                key={color}
                                onClick={() => setPrimaryColor(color)}
                                sx={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: '12px',
                                    backgroundColor: color,
                                    border: color === primaryColor ? '3px solid' : '2px solid',
                                    borderColor: color === primaryColor ? 'text.primary' : 'divider',
                                    cursor: 'pointer',
                                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                                    boxShadow: color === primaryColor
                                        ? '0 4px 10px rgba(0, 0, 0, 0.22)'
                                        : '0 2px 6px rgba(0, 0, 0, 0.12)',
                                    '&:hover': {
                                        transform: 'translateY(-1px)',
                                    },
                                }}
                                title={color}
                                role="button"
                                aria-label={`${t('theme.primaryColor')}: ${color}`}
                            />
                        ))}
                    </Box>
                </Box>
            </Paper>

            <Paper
                elevation={0}
                sx={{
                    p: { xs: 2, sm: 3 },
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                }}
            >
                <Box sx={{ maxWidth: 980 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                        {t('common.selectLanguage')}
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                        {LANGUAGE_OPTIONS.map((lang) => {
                            const isSelected = lang === selectedLanguage;
                            const flagCode = lang === Languages.EN ? 'gb' : lang;

                            return (
                                <Button
                                    key={lang}
                                    onClick={() => {
                                        void i18n.changeLanguage(lang);
                                    }}
                                    variant={isSelected ? 'contained' : 'outlined'}
                                    startIcon={<Flag language={flagCode} style={{ width: 20, height: 15 }} />}
                                    sx={{ minWidth: 110 }}
                                >
                                    {lang.toUpperCase()}
                                </Button>
                            );
                        })}
                    </Stack>
                </Box>
            </Paper>
        </Box>
    );
};

export default SettingsPage;