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
        <Box>
            <Typography variant="h6">{logFile.name}</Typography>
            <Typography 
                variant="body2" 
                color="text.secondary"
            >
                Размер: {logFile.size} байт
            </Typography>
            <Paper 
                sx={{ 
                    p: 2, 
                    whiteSpace: 'pre-wrap', 
                    overflow: 'auto',
                    maxHeight: '80%'
                }}
            >
                {logFile.content}
            </Paper>
        </Box>
    );
}

export default ViewLogsPage;