import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import Slide from '@mui/material/Slide';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import { ColorModeEnum } from '../constants/ColorModeEnum';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import PaletteIcon from '@mui/icons-material/Palette';
import LanguageSelect from './LanguageSelect';
import { useTranslation } from 'react-i18next';
import { useState, useContext } from 'react';
import { ThemeContext } from '../contexts/ThemeContext';
import ThemePaletteDrawer from './ThemePaletteDrawer';

interface HeaderProps {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ isSidebarOpen, toggleSidebar }) => {
    const { i18n } = useTranslation();
    const themeCtx = useContext(ThemeContext);
    if (!themeCtx) return null;
    const { toggleTheme, mode, primaryColor, setPrimaryColor } = themeCtx;
    const [drawerOpen, setDrawerOpen] = useState(false);

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
                        position: 'relative',
                        width: 40,
                        height: 40,
                        overflow: 'hidden',
                    }}
                >
                    <Slide
                        direction="right"
                        in={mode === ColorModeEnum.Dark}
                        mountOnEnter
                        unmountOnExit
                        timeout={300}
                    >
                        <span
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                width: 40,
                                height: 40,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
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
                        <span
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                width: 40,
                                height: 40,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                            <Brightness4Icon />
                        </span>
                    </Slide>
                </IconButton>

                <IconButton
                    color="inherit"
                    aria-label="theme palette"
                    onClick={() => setDrawerOpen(true)}
                    sx={{ marginRight: 2 }}
                >
                    <PaletteIcon />
                </IconButton>

                <LanguageSelect />
            </Toolbar>

            <ThemePaletteDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                onPrimaryChange={setPrimaryColor}
                currentPrimary={primaryColor}
            />
        </AppBar>
    );
}

export default Header;
