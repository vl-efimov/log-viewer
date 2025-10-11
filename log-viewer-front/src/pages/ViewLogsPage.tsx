import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';


const ViewLogsPage: React.FC = () => {
    const logFile = useSelector((state: RootState) => state.logFile);
    if (!logFile.loaded) {
        return <Typography variant="body1">Перетащите текстовый файл с логами на приложение</Typography>;
    }
    return (
        <Box 
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
            }}
        >
            <Paper 
                sx={{ 
                    p: 2, 
                    whiteSpace: 'pre-wrap', 
                    overflow: 'auto',
                }}
            >
                {logFile.content}
            </Paper>
        </Box>
    );
}

export default ViewLogsPage;