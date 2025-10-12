import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';

import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';
import { useEffect, useState } from 'react';
import { getAllLogs } from '../utils/logDb';


const ViewLogsPage: React.FC = () => {
    const logFile = useSelector((state: RootState) => state.logFile);
    const [lines, setLines] = useState<string[]>([]);

    useEffect(() => {
        if (logFile.loaded) {
            getAllLogs().then(logs => setLines(logs.map(l => l.line)));
        } else {
            setLines([]);
        }
    }, [logFile.loaded]);

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
                {lines.map((line, i) => (
                    <div key={i}>{line}</div>
                ))}
            </Paper>
        </Box>
    );
}

export default ViewLogsPage;