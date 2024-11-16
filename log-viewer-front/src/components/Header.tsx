import { AppBar, Toolbar, IconButton, Typography, Switch, Select, MenuItem, SelectChangeEvent } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import { useState } from 'react';

interface HeaderProps {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ isSidebarOpen, toggleSidebar }) => {
    const [isDarkTheme, setDarkTheme] = useState(false);
    const [locale, setLocale] = useState('en');

    const toggleTheme = () => setDarkTheme(!isDarkTheme);
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
                    sx={{ 
                        marginRight: 1,
                    }} 
                    color="inherit" 
                    onClick={toggleTheme}
                >
                    <Switch checked={isDarkTheme} />
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
