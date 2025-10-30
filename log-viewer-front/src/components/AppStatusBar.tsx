import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const VSCODE_BLUE = '#007acc';
const VSCODE_TEXT = '#fff';

const AppStatusBar: React.FC = () => {

    return (
        <Box
            sx={{
                width: '100%',
                height: 32,
                flexShrink: 0,
                bgcolor: VSCODE_BLUE,
                color: VSCODE_TEXT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                fontSize: 14,
                letterSpacing: 0.1,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    height: '100%',
                }}
            >
                <Typography sx={{ color: VSCODE_TEXT }}>Log Viewer</Typography>
            </Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                }}
            >
                <Typography sx={{ color: VSCODE_TEXT }}>
                    Ready
                </Typography>
            </Box>
        </Box>
    );
};

export default AppStatusBar;
