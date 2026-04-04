import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import PaletteIcon from '@mui/icons-material/Palette';
import CloseIcon from '@mui/icons-material/Close';
import LanguageSelect from '../../common/LanguageSelect';
import { useTranslation } from 'react-i18next';
import { useState, useContext } from 'react';
import { ThemeContext } from '../../../contexts/ThemeContext';
import ThemePaletteDrawer from '../ThemePaletteDrawer';
import ThemeToggleButton from '../../common/ThemeToggleButton';
import Box from '@mui/material/Box';
import { ColorModeEnum } from '../../../constants/ColorModeEnum';
import { RootState } from '../../../redux/store';
import { useDispatch, useSelector } from 'react-redux';
import { APP_LAYOUT_TOKENS } from '../../../design-tokens';

import {
    appBarSx,
    toolbarSx,
    menuBoxSx,
    iconButtonSx,
    titleSx,
    rightGroupSx,
    langBoxSx,
} from './styles';
import Tooltip from '@mui/material/Tooltip';
import { clearLogFile, setFileHandle } from '../../../redux/slices/logFileSlice';

interface HeaderProps {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ isSidebarOpen, toggleSidebar }) => {
    const { i18n } = useTranslation();
    const dispatch = useDispatch();
    const themeCtx = useContext(ThemeContext);
    if (!themeCtx) return null;
    const { toggleTheme, mode, primaryColor, setPrimaryColor } = themeCtx;
    const [drawerOpen, setDrawerOpen] = useState(false);

    const textColor = mode === ColorModeEnum.Light ? '#fff' : undefined;

    const {
        name: fileName,
    } = useSelector((state: RootState) => state.logFile);

    const [lastUpdate] = useState<Date | null>(null);

    const handleClearFile = () => {
        dispatch(clearLogFile());
        setFileHandle(null);
    };

    return (
        <AppBar sx={appBarSx}>
            <Toolbar sx={toolbarSx}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        width: isSidebarOpen
                            ? APP_LAYOUT_TOKENS.sidebar.expandedWidth
                            : APP_LAYOUT_TOKENS.sidebar.collapsedWidth,
                        transition: 'width 0.3s ease',
                        overflow: 'hidden',
                    }}
                >
                    <Box sx={menuBoxSx}>
                        <IconButton
                            sx={iconButtonSx(textColor)}
                            aria-label="menu"
                            onClick={toggleSidebar}
                        >
                            {isSidebarOpen ? <MenuOpenIcon /> : <MenuIcon />}
                        </IconButton>
                    </Box>

                    <Box 
                        sx={{
                            display: 'flex',
                            justifyContent:'space-between',
                            width: '100%',
                        }}
                    >
                        <Typography
                            sx={titleSx(textColor)}
                            variant="h6"
                        >
                            {i18n.t('appTitle')}
                        </Typography>
                    </Box>
                </Box>

                {fileName && (
                    <>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                flexGrow: 1,
                                gap: 2,
                            }}
                        >
                            <Typography
                                sx={titleSx(textColor)}
                                variant="h6"
                            >
                                {fileName}
                            </Typography>

                            {lastUpdate && (
                                <Typography variant="caption" color="text.secondary">
                                    Last updated: {lastUpdate.toLocaleTimeString()}
                                </Typography>
                            )}

                            <Tooltip
                                title="Close current file and stop monitoring"
                                arrow
                                placement="top"
                            >
                                <IconButton
                                    onClick={handleClearFile}
                                    sx={iconButtonSx(textColor)}
                                >
                                    <CloseIcon />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </>
                )}

                <Box sx={rightGroupSx}>
                    <ThemeToggleButton
                        mode={mode}
                        toggleTheme={toggleTheme}
                    />
                    <IconButton
                        sx={iconButtonSx(textColor)}
                        aria-label="theme palette"
                        onClick={() => setDrawerOpen(true)}
                    >
                        <PaletteIcon />
                    </IconButton>
                    <Box sx={langBoxSx(textColor)}>
                        <LanguageSelect />
                    </Box>
                </Box>
            </Toolbar>
            <ThemePaletteDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                onPrimaryChange={setPrimaryColor}
                currentPrimary={primaryColor}
                mode={mode}
                onThemeToggle={toggleTheme}
            />
        </AppBar>
    );
}

export default Header;
