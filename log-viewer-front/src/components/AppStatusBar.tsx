import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionIcon from '@mui/icons-material/Description';
import StorageIcon from '@mui/icons-material/Storage';
import CategoryIcon from '@mui/icons-material/Category';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../redux/store';
import { clearLogFile, setFileHandle } from '../redux/slices/logFileSlice';

const VSCODE_BLUE = '#007acc';
const VSCODE_TEXT = '#fff';

const AppStatusBar: React.FC = () => {
    const dispatch = useDispatch();
    const { name, size, format, loaded } = useSelector((state: RootState) => state.logFile);

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    };

    const handleClearFile = () => {
        dispatch(clearLogFile());
        setFileHandle(null);
    };

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
                
                {loaded && (
                    <>
                        <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255, 255, 255, 0.3)', height: 20, alignSelf: 'center' }} />
                        
                        {/* File Name */}
                        <Tooltip 
                            title="Current log file name" 
                            arrow
                            placement="top"
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <DescriptionIcon sx={{ fontSize: 16 }} />
                                <Typography sx={{ color: VSCODE_TEXT, fontWeight: 500 }}>
                                    {name}
                                </Typography>
                            </Box>
                        </Tooltip>

                        {/* File Size */}
                        <Tooltip 
                            title="Total file size on disk" 
                            arrow
                            placement="top"
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <StorageIcon sx={{ fontSize: 16 }} />
                                <Typography sx={{ color: VSCODE_TEXT }}>
                                    {formatFileSize(size)}
                                </Typography>
                            </Box>
                        </Tooltip>

                        {/* File Format */}
                        {format && (
                            <Tooltip 
                                title="Detected log format type" 
                                arrow
                                placement="top"
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <CategoryIcon sx={{ fontSize: 16 }} />
                                    <Typography sx={{ color: VSCODE_TEXT }}>
                                        {format}
                                    </Typography>
                                </Box>
                            </Tooltip>
                        )}

                        {/* Clear File Button */}
                        <Tooltip 
                            title="Close current file and stop monitoring" 
                            arrow
                            placement="top"
                        >
                            <IconButton
                                onClick={handleClearFile}
                                size="small"
                                sx={{
                                    color: VSCODE_TEXT,
                                    padding: 0.5,
                                    '&:hover': {
                                        bgcolor: 'rgba(255, 255, 255, 0.1)',
                                    },
                                }}
                            >
                                <CloseIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                    </>
                )}
            </Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                }}
            >
                <Typography sx={{ color: VSCODE_TEXT }}>
                    {loaded ? 'Monitoring' : 'Ready'}
                </Typography>
            </Box>
        </Box>
    );
};

export default AppStatusBar;
