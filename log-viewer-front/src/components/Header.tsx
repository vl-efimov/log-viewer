import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import PaletteIcon from '@mui/icons-material/Palette';
import LanguageSelect from './LanguageSelect';
import { useTranslation } from 'react-i18next';
import { useState, useContext } from 'react';
import { ThemeContext } from '../contexts/ThemeContext';
import ThemePaletteDrawer from './ThemePaletteDrawer';
import ThemeToggleButton from './ThemeToggleButton';
import Box from '@mui/material/Box';

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

    const textColor = mode === 'light' ? '#fff' : undefined;
    return (
        <AppBar
            sx={{
                backgroundColor: (theme) => theme.custom?.headerBg,
            }}
        >
            <Toolbar>
                <IconButton
                    sx={{
                        marginRight: 2,
                        color: textColor,
                    }}
                    aria-label="menu"
                    onClick={toggleSidebar}
                >
                    {isSidebarOpen ? <MenuOpenIcon /> : <MenuIcon />}
                </IconButton>
                <Typography
                    sx={{
                        flexGrow: 1,
                        color: textColor,
                    }}
                    variant="h6"
                >
                    {i18n.t('appTitle')}
                </Typography>

                <Box sx={{ display: 'flex', gap: 2}}>
                    <ThemeToggleButton
                        mode={mode}
                        toggleTheme={toggleTheme}
                    />

                    <IconButton
                        sx={{ color: textColor }}
                        aria-label="theme palette"
                        onClick={() => setDrawerOpen(true)}
                    >
                        <PaletteIcon />
                    </IconButton>

                    <Box sx={{ color: textColor }}>
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
