
import { useEffect, useState, useCallback, useMemo } from 'react';
import AddLogFormatDialog from '../components/log-patterns/AddLogFormatDialog';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
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
import RegexHighlighter from '../components/log-patterns/RegexHighlighter';
import ConfirmActionDialog from '../components/common/ConfirmActionDialog';
import { baseUrl } from '../constants/BaseUrl';
import {
    buildCustomFormatPattern,
    registerCustomLogFormat,
    unregisterLogFormat,
} from '../utils/logFormatDetector';
import {
    deleteCustomLogFormat,
    getCustomLogFormats,
    upsertCustomLogFormat,
    type CustomLogFormatRecord,
} from '../utils/logIndexedDb';

interface LogFormat {
    id: string;
    name: string;
    description: string;
    patterns: string[];
    priority: number;
}

const LogFormatsPage: React.FC = () => {
    const [systemFormats, setSystemFormats] = useState<LogFormat[]>([]);
    const [userFormats, setUserFormats] = useState<CustomLogFormatRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [editingFormat, setEditingFormat] = useState<CustomLogFormatRecord | null>(null);
    const [deleteDialogState, setDeleteDialogState] = useState<{ open: boolean; formatId: string; formatName: string }>(
        { open: false, formatId: '', formatName: '' }
    );

    const loadFormats = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [response, customFormats] = await Promise.all([
                fetch(`${baseUrl}log-formats.json`),
                getCustomLogFormats(),
            ]);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setSystemFormats(data.formats || []);

            setUserFormats(customFormats);
            customFormats.forEach((customFormat) => {
                const runtimeFormat = buildCustomFormatPattern(customFormat);
                if (runtimeFormat) {
                    registerCustomLogFormat(runtimeFormat);
                }
            });
        } catch (error: unknown) {
            console.error('Failed to load log formats:', error);
            setSystemFormats([]);
            setUserFormats([]);
            setError('Failed to load supported log formats. Please check your connection or file location.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadFormats();
    }, [loadFormats]);

    const sortedSystemFormats = useMemo(() => [...systemFormats].sort((a, b) => a.name.localeCompare(b.name)), [systemFormats]);
    const sortedUserFormats = useMemo(() => [...userFormats].sort((a, b) => a.name.localeCompare(b.name)), [userFormats]);
    const nameColumnSx = { width: 130, minWidth: 130, verticalAlign: 'top' };
    const descriptionColumnSx = { width: 240, minWidth: 240, verticalAlign: 'top' };

    const handleSaveFormat = useCallback(async (payload: { name: string; description: string; regex: string }) => {
        const id = editingFormat?.id ?? `user-${Date.now()}`;

        const saved = await upsertCustomLogFormat({
            id,
            name: payload.name,
            description: payload.description,
            regex: payload.regex,
        });

        const runtimeFormat = buildCustomFormatPattern(saved);
        if (runtimeFormat) {
            registerCustomLogFormat(runtimeFormat);
        }

        setUserFormats((prev) => {
            const existingIndex = prev.findIndex((format) => format.id === saved.id);
            if (existingIndex >= 0) {
                const next = [...prev];
                next[existingIndex] = saved;
                return next;
            }

            return [...prev, saved];
        });

        setAddOpen(false);
        setEditingFormat(null);
    }, [editingFormat?.id]);

    const deleteUserFormat = useCallback(async (id: string) => {
        await deleteCustomLogFormat(id);
        unregisterLogFormat(id);
        setUserFormats((prev) => prev.filter((format) => format.id !== id));
    }, []);

    const handleDeleteRequest = (format: CustomLogFormatRecord) => {
        setDeleteDialogState({ open: true, formatId: format.id, formatName: format.name });
    };

    const handleDeleteConfirm = async () => {
        const targetId = deleteDialogState.formatId;
        setDeleteDialogState({ open: false, formatId: '', formatName: '' });
        if (!targetId) return;
        await deleteUserFormat(targetId);
    };

    const handleDeleteCancel = () => {
        setDeleteDialogState({ open: false, formatId: '', formatName: '' });
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                <CircularProgress />
            </Box>
        );
    }


    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography
                    variant="h5"
                    gutterBottom
                    sx={{ flexGrow: 1 }}
                >
                    Custom Formats
                </Typography>
                <Button
                    variant="outlined"
                    size="small"
                    sx={{ textTransform: 'none' }}
                    startIcon={<AddIcon />}
                    onClick={() => {
                        setEditingFormat(null);
                        setAddOpen(true);
                    }}
                >
                    Add custom format
                </Button>
            </Box>
            <TableContainer
                component={Paper}
                sx={{ mb: 4 }}
            >
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={nameColumnSx}>Name</TableCell>
                            <TableCell sx={descriptionColumnSx}>Description</TableCell>
                            <TableCell>Regular Expressions</TableCell>
                            <TableCell sx={{ width: 64, minWidth: 64 }}>Actions</TableCell>
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
                                    <TableCell sx={nameColumnSx}>{format.name}</TableCell>
                                    <TableCell sx={descriptionColumnSx}>{format.description}</TableCell>
                                    <TableCell sx={{ verticalAlign: 'top' }}>
                                        <RegexHighlighter pattern={format.regex} />
                                    </TableCell>
                                    <TableCell sx={{ width: 64, minWidth: 64, verticalAlign: 'top' }}>
                                        <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                            <Tooltip title="Edit" arrow>
                                                <IconButton
                                                    size="small"
                                                    color="primary"
                                                    aria-label="Edit custom format"
                                                    onClick={() => {
                                                        setEditingFormat(format);
                                                        setAddOpen(true);
                                                    }}
                                                >
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Delete" arrow>
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    aria-label="Delete custom format"
                                                    onClick={() => handleDeleteRequest(format)}
                                                >
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <AddLogFormatDialog
                open={addOpen}
                onClose={() => {
                    setAddOpen(false);
                    setEditingFormat(null);
                }}
                onSubmit={handleSaveFormat}
                initialValue={editingFormat ?? undefined}
                title={editingFormat ? 'Edit Custom Log Format' : 'Add Custom Log Format'}
                submitLabel={editingFormat ? 'Save changes' : 'Add'}
            />

            <ConfirmActionDialog
                open={deleteDialogState.open}
                message={`Delete selected custom format${deleteDialogState.formatName ? ` "${deleteDialogState.formatName}"` : ''}?`}
                confirmLabel="OK"
                cancelLabel="Отмена"
                onConfirm={() => void handleDeleteConfirm()}
                onCancel={handleDeleteCancel}
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
                                <TableCell sx={nameColumnSx}>Name</TableCell>
                                <TableCell sx={descriptionColumnSx}>Description</TableCell>
                                <TableCell>Regular Expressions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {sortedSystemFormats.map((format) => (
                                <TableRow key={format.id}>
                                    <TableCell sx={nameColumnSx}>{format.name}</TableCell>
                                    <TableCell sx={descriptionColumnSx}>{format.description}</TableCell>
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
