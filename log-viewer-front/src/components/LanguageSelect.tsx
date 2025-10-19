import { useState } from 'react';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import type { SelectChangeEvent } from '@mui/material/Select';
import { useTranslation } from 'react-i18next';
import Flag from './Flag';
import { Languages } from '../constants/LanguagesEnum';
import Typography from '@mui/material/Typography';

const LANGUAGES = [Languages.EN, Languages.RU, Languages.CZ];

const flagStyle = { marginRight: 8, width: 20, height: 15 };

const LanguageSelect = () => {
    const { i18n } = useTranslation();
    const [locale, setLocale] = useState(Languages.EN);

    const handleLocaleChange = (event: SelectChangeEvent<string>) => {
        const newLocale = event.target.value as Languages;
        setLocale(newLocale);
        i18n.changeLanguage(newLocale);
    };

    return (
        <Select
            value={locale}
            onChange={handleLocaleChange}
            IconComponent={() => <span style={{ display: 'none' }} />}
            MenuProps={{
                PaperProps: {
                    sx: {
                        boxShadow: 3,
                    },
                },
            }}
            sx={{
                '& .MuiOutlinedInput-notchedOutline': {
                    border: 'none',
                },
                '&:hover': {
                    backgroundColor: 'transparent',
                },
            }}
        >
            {LANGUAGES.map((lang) => (
                <MenuItem
                    key={lang}
                    value={lang}
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
        </Select>
    );
};

export default LanguageSelect;
