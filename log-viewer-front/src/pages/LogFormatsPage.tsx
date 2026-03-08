
import { useEffect, useState, useCallback, useMemo } from 'react';
import AddLogFormatDialog from '../components/AddLogFormatDialog';
import IconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ReplayIcon from '@mui/icons-material/Replay';
import CircularProgress from '@mui/material/CircularProgress';
import RegexHighlighter from '../components/RegexHighlighter';
import { baseUrl } from '../constants/BaseUrl';

interface UserLogFormat {
    id: string;
    name: string;
    description: string;
    regex: string;
}

const USER_FORMATS_KEY = 'logViewerUserFormats';

function loadUserFormats(): UserLogFormat[] {
    try {
        const raw = localStorage.getItem(USER_FORMATS_KEY);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

function saveUserFormats(formats: UserLogFormat[]) {
    localStorage.setItem(USER_FORMATS_KEY, JSON.stringify(formats));
}

interface LogFormat {
    id: string;
    name: string;
    description: string;
    patterns: string[];
    priority: number;
}

const LogFormatsPage: React.FC = () => {
    console.log('LogFormatsPage render');
    const [systemFormats, setSystemFormats] = useState<LogFormat[]>([]);
    const [userFormats, setUserFormats] = useState<UserLogFormat[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadFormats = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${baseUrl}log-formats.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setSystemFormats(data.formats || []);
        } catch (error: unknown) {
            console.error('Failed to load log formats:', error);
            setSystemFormats([]);
            setError('Failed to load supported log formats. Please check your connection or file location.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFormats();
        setUserFormats(loadUserFormats());
    }, []);

    const sortedSystemFormats = useMemo(() => [...systemFormats].sort((a, b) => a.name.localeCompare(b.name)), [systemFormats]);
    const sortedUserFormats = useMemo(() => [...userFormats].sort((a, b) => a.name.localeCompare(b.name)), [userFormats]);

    const [addOpen, setAddOpen] = useState(false);

    const handleAddFormat = useCallback((name: string, description: string, regex: string) => {
        const newFormat: UserLogFormat = {
            id: `user-${Date.now()}`,
            name,
            description,
            regex,
        };
        const updated = [...userFormats, newFormat];
        setUserFormats(updated);
        saveUserFormats(updated);
        setAddOpen(false);
    }, [userFormats]);

    const deleteUserFormat = useCallback((id: string) => {
        const updated = userFormats.filter(f => f.id !== id);
        setUserFormats(updated);
        saveUserFormats(updated);
    }, [userFormats]);

    if (loading) {
        return (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                <CircularProgress />
            </Box>
        );
    }


    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="h5" gutterBottom sx={{ flexGrow: 1 }}>
                    Custom Formats
                </Typography>
                <IconButton color="primary" onClick={() => setAddOpen(true)} size="large">
                    <AddIcon />
                </IconButton>
            </Box>
            <TableContainer component={Paper} sx={{ mb: 4 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell>Regular Expressions</TableCell>
                            <TableCell>Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedUserFormats.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary' }}>
                                    No custom formats
                                </TableCell>
                            </TableRow>
                        ) : (
                            sortedUserFormats.map((format) => (
                                <TableRow key={format.id}>
                                    <TableCell>{format.name}</TableCell>
                                    <TableCell>{format.description}</TableCell>
                                    <TableCell>
                                        <div style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{format.regex}</div>
                                    </TableCell>
                                    <TableCell>
                                        <Button size="small" color="primary" disabled>Edit</Button>
                                        <Button size="small" color="error" onClick={() => deleteUserFormat(format.id)}>Delete</Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <AddLogFormatDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onAdd={handleAddFormat}
            />

            <Typography 
                variant="h5" 
                gutterBottom
            >
                Supported Log Formats
            </Typography>
            {error ? (
                <Stack 
                    sx={{ 
                        mb: 4, 
                        minWidth: 320 
                    }} 
                    spacing={2}
                >
                    <Alert
                        severity="error"
                        action={
                            <Button
                                color="inherit" 
                                startIcon={<ReplayIcon />}
                                onClick={loadFormats}
                            >
                                Retry
                            </Button>
                        }
                    >
                        {error}
                    </Alert>
                </Stack>
            ) : (
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Description</TableCell>
                                <TableCell>Regular Expressions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {sortedSystemFormats.map((format) => (
                                <TableRow key={format.id}>
                                    <TableCell sx={{ verticalAlign: 'top' }}>{format.name}</TableCell>
                                    <TableCell sx={{ verticalAlign: 'top' }}>{format.description}</TableCell>
                                    <TableCell sx={{ verticalAlign: 'top' }}>
                                        {format.patterns.map((pattern, i) => (
                                            <Box 
                                                key={i} 
                                                sx={{ mb: i < format.patterns.length - 1 ? 2 : 0 }}
                                            >
                                                <RegexHighlighter pattern={pattern} />
                                            </Box>
                                        ))}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
};

export default LogFormatsPage;
