
import { useEffect, useState } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import RegexHighlighter from '../components/RegexHighlighter';

const userFormats: Array<{
    id: string;
    name: string;
    description: string;
    regex: string;
}> = [];

interface LogFormat {
    id: string;
    name: string;
    description: string;
    patterns: string[];
    priority: number;
}

const LogFormatsPage: React.FC = () => {
    const [systemFormats, setSystemFormats] = useState<LogFormat[]>([]);
    const [loading, setLoading] = useState(true);

    const loadFormats = async () => {
        try {
            const response = await fetch('/log-formats.json');
            const data = await response.json();
            setSystemFormats(data.formats || []);
        } catch (error) {
            console.error('Failed to load log formats:', error);
            setSystemFormats([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFormats();
    }, []);

    const sortedSystemFormats = [...systemFormats].sort((a, b) => a.name.localeCompare(b.name));
    const sortedUserFormats = [...userFormats].sort((a, b) => a.name.localeCompare(b.name));

    if (loading) {
        return (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3 }}>
            <Typography 
                variant="h5" 
                gutterBottom
            >
                Custom Formats
            </Typography>
            <TableContainer 
                component={Paper} 
                sx={{ mb: 4 }}
            >
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
                                <TableCell 
                                    colSpan={4} 
                                    align="center"
                                    sx={{ color: 'text.secondary' }}
                                >
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
                                        <Button size="small" color="primary">Edit</Button>
                                        <Button size="small" color="error">Delete</Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Typography 
                variant="h5" 
                gutterBottom
            >
                Supported Log Formats
            </Typography>
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
        </Box>
    );
};

export default LogFormatsPage;
