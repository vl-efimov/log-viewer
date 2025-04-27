import { useState } from 'react';
import { Select, MenuItem, SelectChangeEvent } from '@mui/material';
import { useTranslation } from 'react-i18next';
import Flag from './Flag';



const LanguageSelect = () => {
    const { i18n } = useTranslation();
    const [open, setOpen] = useState(false);
    const [locale, setLocale] = useState('en');

    const handleLocaleChange = (event: SelectChangeEvent<string>) => {
        const newLocale = event.target.value;
        setLocale(newLocale);
        i18n.changeLanguage(newLocale);
        setOpen(false);
    };


    return (
        <Select
            value={locale}
            onChange={handleLocaleChange}
            open={open}
            IconComponent={() => null}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
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
            <MenuItem value="en">
                <Flag
                    language="gb"
                    style={{ marginRight: '8px', width: '20px', height: '15px' }}
                />
                EN
            </MenuItem>
            <MenuItem value="ru">
                <Flag
                    language="ru"

                    style={{ marginRight: '8px', width: '20px', height: '15px' }}
                />
                RU
            </MenuItem>
            <MenuItem value="cz">
                <Flag
                    language="cz"
                    style={{ marginRight: '8px', width: '20px', height: '15px' }}
                />
                CZ
            </MenuItem>
        </Select>
    );
};

export default LanguageSelect;
