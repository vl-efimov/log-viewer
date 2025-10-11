import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';

const VSCODE_BLUE = '#007acc';
const VSCODE_TEXT = '#fff';

const AppStatusBar: React.FC = () => {
    const logFile = useSelector((state: RootState) => state.logFile);
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
                    gap: 2
                }}
            >
                {logFile.loaded ? (
                    <>
                        <Typography
                            sx={{ 
                                color: VSCODE_TEXT 
                            }}
                        >
                            {logFile.name}
                        </Typography>
                        <Typography
                            sx={{ 
                                color: VSCODE_TEXT 
                            }}
                        >
                            {`${(logFile.size / (1024 * 1024)).toFixed(2)} МБ`}
                        </Typography>
                    </>
                ) : (
                    <Typography
                        sx={{ color: VSCODE_TEXT }}
                    >
                        Файл не выбран
                    </Typography>
                )}
            </Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2
                }}
            >
                <Typography
                    sx={{ color: VSCODE_TEXT }}
                >
                    Готово
                </Typography>
            </Box>
        </Box>
    );
};

export default AppStatusBar;
