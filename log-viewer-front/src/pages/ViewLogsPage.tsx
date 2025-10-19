import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import { useEffect, useState } from 'react';
import { getAllFiles, getAllLogs } from '../utils/logDb';


const ViewLogsPage: React.FC = () => {
    const [lines, setLines] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [fileName, setFileName] = useState<string>('');

    useEffect(() => {
        const loadLogs = async () => {
            setLoading(true);
            try {
                // Get all files and show the latest one
                const files = await getAllFiles();
                if (files.length === 0) {
                    setLines([]);
                    setLoading(false);
                    return;
                }
                
                // Get the latest file (last in array)
                const latestFile = files[files.length - 1];
                setFileName(latestFile.name);
                
                // Load logs for this file
                const logs = await getAllLogs(latestFile.id!);
                setLines(logs.map(l => l.line));
            } catch (error) {
                console.error('Error loading logs:', error);
            } finally {
                setLoading(false);
            }
        };

        loadLogs();
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
            <Typography variant="h6" sx={{ mb: 2 }}>
                {fileName}
            </Typography>
            <Paper
                sx={{
                    p: 2,
                    whiteSpace: 'pre-wrap',
                    overflow: 'auto',
                    flexGrow: 1,
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