import Box from '@mui/material/Box';
import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useTranslation } from 'react-i18next';
import Flag from './Flag';
import { Languages } from '../constants/LanguagesEnum';
import Typography from '@mui/material/Typography';

const LANGUAGES = [Languages.EN, Languages.RU, Languages.CZ];

const flagStyle = { marginRight: 8, width: 20, height: 15 };

const LanguageSelect = () => {
    const { i18n } = useTranslation();
    const [locale, setLocale] = useState(Languages.EN);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

    const handleButtonClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
    };

    const handleLocaleSelect = (lang: Languages) => {
        setLocale(lang);
        i18n.changeLanguage(lang);
        setAnchorEl(null);
    };

    // Preload flag images for all languages
    const flagSrcs = LANGUAGES.map(lang => {
        const code = lang === Languages.EN ? 'gb' : lang;
        return `/src/assets/flags/${code}.svg`;
    });

    return (
        <>
            <div style={{ display: 'none' }}>
                {flagSrcs.map(src => (
                    <img src={src} alt="preload-flag" key={src} />
                ))}
            </div>
            <IconButton
                onClick={handleButtonClick}
                color="inherit"
                aria-label="select language"
                sx={{
                    marginRight: 2,
                    width: 40,
                    height: 40,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    background: 'transparent',
                }}
                size="large"
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: 'transparent',
                    }}
                >
                    <Flag
                        language={locale === Languages.EN ? 'gb' : locale}
                        style={{ width: 24, height: 18, objectFit: 'contain' }}
                    />
                </Box>
            </IconButton>
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleMenuClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            >
                {LANGUAGES.map((lang) => (
                    <MenuItem
                        key={lang}
                        selected={locale === lang}
                        onClick={() => handleLocaleSelect(lang)}
                    >
                        <Flag
                            language={lang === Languages.EN ? 'gb' : lang}
                            style={flagStyle}
                        />
                        <Typography
                            variant="body1"
                            component="span"
                        >
                            {lang.toUpperCase()}
                        </Typography>
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};

export default LanguageSelect;
