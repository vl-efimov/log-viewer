import { AppBar, Toolbar, IconButton, Typography, FormControl } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import { ColorModeEnum } from '../constants/ColorModeEnum';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { useThemeMode } from '../hooks/useThemeMode';
import LanguageSelect from './LanguageSelect';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ isSidebarOpen, toggleSidebar }) => {
    const { toggleTheme, mode } = useThemeMode();
    const { i18n } = useTranslation();

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
                    {i18n.t('appTitle')}
                </Typography>

                <IconButton
                    onClick={toggleTheme}
                    color="inherit"
                    sx={{
                        marginRight: 2,
                    }}
                >
                    {mode === ColorModeEnum.Dark ? <Brightness7Icon /> : <Brightness4Icon />}
                </IconButton>

                <FormControl sx={{ minWidth: 100 }}>
                    <LanguageSelect />
                </FormControl>
            </Toolbar>
        </AppBar>
    );
}

export default Header;
