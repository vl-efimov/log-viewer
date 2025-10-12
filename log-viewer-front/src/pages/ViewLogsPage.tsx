import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import { useEffect, useState } from 'react';
import { getAllLogs } from '../utils/logDb';


const ViewLogsPage: React.FC = () => {
    const [lines, setLines] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        getAllLogs().then(logs => {
            setLines(logs.map(l => l.line));
            setLoading(false);
        });
    }, []);

    if (loading) {
        return <Typography variant="body1">Загрузка...</Typography>;
    }
    if (lines.length === 0) {
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