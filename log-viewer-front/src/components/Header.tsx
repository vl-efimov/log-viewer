import { AppBar, Toolbar, IconButton, Typography, FormControl, Slide } from '@mui/material';
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
                    sx={{ marginRight: 2, position: 'relative', width: 40, height: 40, overflow: 'hidden' }}
                >
                    <Slide
                        direction="right"
                        in={mode === ColorModeEnum.Dark}
                        mountOnEnter
                        unmountOnExit
                        timeout={300}
                    >
                        <span style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Brightness7Icon />
                        </span>
                    </Slide>
                    <Slide
                        direction="left"
                        in={mode !== ColorModeEnum.Dark}
                        mountOnEnter
                        unmountOnExit
                        timeout={300}
                    >
                        <span style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Brightness4Icon />
                        </span>
                    </Slide>
                </IconButton>

                <FormControl sx={{ minWidth: 100 }}>
                    <LanguageSelect />
                </FormControl>
            </Toolbar>
        </AppBar>
    );
}

export default Header;
