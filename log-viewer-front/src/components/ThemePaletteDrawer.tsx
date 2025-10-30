import Typography from '@mui/material/Typography';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { ColorModeEnum } from '../constants/ColorModeEnum';

interface ThemePaletteDrawerProps {
    open: boolean;
    onClose: () => void;
    onPrimaryChange: (color: string) => void;
    currentPrimary: string;
    mode: ColorModeEnum;
    onThemeToggle: () => void;
}

const PRIMARY_COLORS = [
    '#334155',
    '#10b981',
    '#22c55e',
    '#84cc16',
    '#f97316',
    '#ff9800',
    '#f59e0b',
    '#eab308',
    '#14b8a6',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#ec4899',
    '#f43f5e',
];

const ThemePaletteDrawer: React.FC<ThemePaletteDrawerProps> = ({ open, onClose, onPrimaryChange, currentPrimary, mode, onThemeToggle }) => {
    return (
        <Drawer
            anchor="right"
            open={open}
            onClose={onClose}
            slotProps={{
                paper: {
                    sx: {
                        backdropFilter: 'blur(12px)',
                        backgroundColor: (theme) =>
                            theme.palette.mode === 'light'
                                ? 'rgba(255, 255, 255, 0.9)'
                                : 'rgba(30, 41, 59, 0.9)',
                        zIndex: (theme) => theme.zIndex.appBar + 1,
                    }
                }
            }}
        >
            <Box
                sx={{
                    pt: 3,
                    px: 3,
                    pb: 3,
                    width: 320,
                    position: 'relative',
                }}
            >
                <IconButton
                    onClick={onClose}
                    sx={{
                        position: 'absolute',
                        right: 8,
                        top: 8,
                        '&:hover': {
                            backgroundColor: 'rgba(0, 0, 0, 0.05)',
                        },
                    }}
                    aria-label="close"
                >
                    <CloseIcon />
                </IconButton>
                
                <Typography
                    variant="h5"
                    gutterBottom
                    sx={{ fontWeight: 600, mb: 3, mt: 2 }}
                >
                    Theme Settings
                </Typography>

                <Box sx={{ mb: 4 }}>
                    <Typography
                        variant="subtitle2"
                        gutterBottom
                        sx={{
                            fontWeight: 600,
                            color: 'text.secondary',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            mb: 2
                        }}
                    >
                        Theme Mode
                    </Typography>
                    <Box
                        sx={{
                            display: 'flex',
                            gap: 1,
                        }}
                    >
                        <Box
                            onClick={() => mode === ColorModeEnum.Dark && onThemeToggle()}
                            sx={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 1,
                                py: 1.5,
                                borderRadius: 2,
                                cursor: 'pointer',
                                backgroundColor: mode === ColorModeEnum.Light 
                                    ? 'primary.main' 
                                    : 'action.hover',
                                color: mode === ColorModeEnum.Light 
                                    ? 'primary.contrastText' 
                                    : 'text.primary',
                                border: '2px solid',
                                borderColor: mode === ColorModeEnum.Light 
                                    ? 'primary.main' 
                                    : 'divider',
                                boxShadow: mode === ColorModeEnum.Light 
                                    ? '0 2px 8px rgba(0, 0, 0, 0.15)' 
                                    : 'none',
                                '&:hover': {
                                    backgroundColor: mode === ColorModeEnum.Light 
                                        ? 'primary.dark' 
                                        : 'action.selected',
                                },
                            }}
                        >
                            <LightModeIcon />
                            <Typography variant="body2">
                                Light
                            </Typography>
                        </Box>
                        <Box
                            onClick={() => mode === ColorModeEnum.Light && onThemeToggle()}
                            sx={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 1,
                                py: 1.5,
                                borderRadius: 2,
                                cursor: 'pointer',
                                backgroundColor: mode === ColorModeEnum.Dark 
                                    ? 'primary.main' 
                                    : 'action.hover',
                                color: mode === ColorModeEnum.Dark 
                                    ? 'primary.contrastText' 
                                    : 'text.primary',
                                border: '2px solid',
                                borderColor: mode === ColorModeEnum.Dark 
                                    ? 'primary.main' 
                                    : 'divider',
                                boxShadow: mode === ColorModeEnum.Dark 
                                    ? '0 2px 8px rgba(0, 0, 0, 0.15)' 
                                    : 'none',
                                '&:hover': {
                                    backgroundColor: mode === ColorModeEnum.Dark 
                                        ? 'primary.dark' 
                                        : 'action.selected',
                                },
                            }}
                        >
                            <DarkModeIcon />
                            <Typography variant="body2">
                                Dark
                            </Typography>
                        </Box>
                    </Box>
                </Box>

                <Typography
                    variant="subtitle2"
                    gutterBottom
                    sx={{
                        fontWeight: 600,
                        color: 'text.secondary',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        mb: 2
                    }}
                >
                    Primary Color
                </Typography>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: 1,
                    }}
                >
                    {PRIMARY_COLORS.map((color) => (
                        <Box
                            key={color}
                            onClick={() => onPrimaryChange(color)}
                            sx={{
                                width: 40,
                                height: 40,
                                borderRadius: '12px',
                                background: color,
                                border: color === currentPrimary ? '3px solid' : '2px solid transparent',
                                borderColor: color === currentPrimary ? 'text.primary' : 'transparent',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                boxShadow: color === currentPrimary
                                    ? '0 4px 12px rgba(0, 0, 0, 0.15)'
                                    : '0 2px 4px rgba(0, 0, 0, 0.1)',
                                '&:hover': {
                                    transform: 'scale(1.1)',
                                    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.2)',
                                },
                                '&:active': {
                                    transform: 'scale(0.95)',
                                },
                            }}
                            title={color}
                        />
                    ))}
                </Box>
            </Box>
        </Drawer>
    );
};

export default ThemePaletteDrawer;