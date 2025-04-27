import { AppBar, Toolbar, IconButton, Typography, Select, MenuItem, SelectChangeEvent } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import { ColorModeEnum } from '../constants/ColorModeEnum';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { useThemeMode } from '../hooks/useThemeMode';
import { useState } from 'react';

interface HeaderProps {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ isSidebarOpen, toggleSidebar }) => {
    const { toggleTheme, mode } = useThemeMode();
    const [locale, setLocale] = useState('en');

    const handleLocaleChange = (event: SelectChangeEvent<string>) => setLocale(event.target.value as string);

    return (
        <AppBar 
            position='fixed' 
            sx={{ 
                zIndex: (theme) => theme.zIndex.drawer + 1 
            }}
        >
            <Toolbar>
                <IconButton 
                    sx={{ 
                        marginRight: 2,
                    }}
                    color="inherit" 
                    aria-label="menu" 
                    onClick={toggleSidebar}
                >
                    {isSidebarOpen ? <MenuOpenIcon /> : <MenuIcon />}
                </IconButton>
                <Typography 
                    sx={{ 
                        flexGrow: 1,
                    }} 
                    variant="h6"
                >
                    LogViewer
                </Typography>
                <IconButton 
                    onClick={toggleTheme} 
                    color="inherit"
                >
                    {mode === ColorModeEnum.Dark ? <Brightness7Icon /> : <Brightness4Icon />}
                </IconButton>
                <Select 
                    value={locale} 
                    onChange={handleLocaleChange}
                >
                    <MenuItem value="en">EN</MenuItem>
                    <MenuItem value="ru">RU</MenuItem>
                </Select>
            </Toolbar>
        </AppBar>
    );
}

export default Header;
