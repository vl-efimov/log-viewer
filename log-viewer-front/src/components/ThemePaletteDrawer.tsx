import Typography from '@mui/material/Typography';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';

interface ThemePaletteDrawerProps {
    open: boolean;
    onClose: () => void;
    onPrimaryChange: (color: string) => void;
    currentPrimary: string;
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

const ThemePaletteDrawer: React.FC<ThemePaletteDrawerProps> = ({ open, onClose, onPrimaryChange, currentPrimary }) => {
    return (
        <Drawer anchor="right" open={open} onClose={onClose}>
            <div style={{ width: 280, padding: 24 }}>
                <Typography variant="h6" gutterBottom>Theme Settings</Typography>
                <Typography variant="subtitle1" gutterBottom>Primary Color</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap',  gap: 1, marginBottom: 16 }}>
                    {PRIMARY_COLORS.map(color => (
                        <div
                            key={color}
                            onClick={() => onPrimaryChange(color)}
                            style={{
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                background: color,
                                border: color === currentPrimary ? '3px solid #000' : '2px solid #ccc',
                                cursor: 'pointer',
                            }}
                            title={color}
                        />
                    ))}
                </Box>
            </div>
        </Drawer>
    );
};

export default ThemePaletteDrawer;