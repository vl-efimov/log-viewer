import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import React from 'react';
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { RouteHome } from '../routes/routePaths';
import { RootState } from '../redux/store';
import { updateLogContent, appendLogContent, setMonitoringState } from '../redux/slices/logFileSlice';
import { getFileHandle } from '../redux/slices/logFileSlice';
import { parseLogFileForTable } from '../utils/logFormatExamples';


const ViewLogsPage: React.FC = () => {
    const [selectedLine, setSelectedLine] = useState<number | null>(null);
    const [openGroups, setOpenGroups] = useState<{[key: number]: boolean}>({});

    const handleToggleGroup = (groupStart: number) => {
        setOpenGroups(prev => ({ ...prev, [groupStart]: !prev[groupStart] }));
    };

    // Grouping consecutive unparsed lines
    function groupParsedLines(parsedLines: typeof parsedLines) {
        const allFields = Array.from(new Set(parsedLines.flatMap(r => r.parsed?.fields ? Object.keys(r.parsed.fields) : [])));
        const result: Array<any> = [];
        let i = 0;
        while (i < parsedLines.length) {
            if (!parsedLines[i].parsed) {
                let group = [];
                while (i < parsedLines.length && !parsedLines[i].parsed) {
                    group.push(parsedLines[i]);
                    i++;
                }
                result.push({ type: 'unparsed', lines: group, startLine: group[0].lineNumber, allFields });
            } else {
                result.push({ type: 'parsed', line: parsedLines[i], allFields });
                i++;
            }
        }
        return result;
    }
    const [openRows, setOpenRows] = useState<{[key: number]: boolean}>({});

    const handleToggleRow = (lineNumber: number) => {
        setOpenRows(prev => ({ ...prev, [lineNumber]: !prev[lineNumber] }));
    };
    const dispatch = useDispatch();
    const navigate = useNavigate();
    
    // Get data from Redux
    const { content, name: fileName, isMonitoring, hasFileHandle, size: fileSize } = useSelector((state: RootState) => state.logFile);
    
    const [parsedLines, setParsedLines] = useState<Array<{
        lineNumber: number;
        parsed: import('../utils/logFormatDetector').ParsedLogLine | null;
        raw: string;
        error?: string;
            }>>([]);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [newLinesCount, setNewLinesCount] = useState<number>(0);
    const lastModifiedRef = useRef<number>(0);
    const lastSizeRef = useRef<number>(0);
    const previousLineCountRef = useRef<number>(0);

    // Load initial content from Redux
    useEffect(() => {
        const safeContent = content ?? "";
        const parsed = parseLogFileForTable(safeContent);
        setParsedLines(parsed);
        setLastUpdate(new Date());
        // Track new lines added
        if (previousLineCountRef.current > 0 && parsed.length - previousLineCountRef.current > 0) {
            setNewLinesCount(parsed.length - previousLineCountRef.current);
            setTimeout(() => setNewLinesCount(0), 3000);
        }
        previousLineCountRef.current = parsed.length;
        lastSizeRef.current = fileSize;
    }, [content, fileSize]);

    // Poll for file changes using File System Access API with incremental reading
    useEffect(() => {
        if (!isMonitoring || !autoRefresh || !hasFileHandle) return;

        const fileHandle = getFileHandle();
        if (!fileHandle) return;

        let intervalId: number | null = null;

        const startPolling = async () => {
            try {
                // Read initial state
                const file = await fileHandle.getFile();
                lastModifiedRef.current = file.lastModified;
                lastSizeRef.current = file.size;

                // Start polling for changes
                intervalId = window.setInterval(async () => {
                    try {
                        const file = await fileHandle.getFile();
                        
                        // Check if file was modified
                        if (file.lastModified > lastModifiedRef.current) {
                            lastModifiedRef.current = file.lastModified;
                            const currentSize = file.size;

                            // Check if file was truncated (size decreased) - full reload needed
                            if (currentSize < lastSizeRef.current) {
                                console.log('File truncated, performing full reload');
                                const fullContent = await file.text();
                                
                                dispatch(updateLogContent({
                                    content: fullContent,
                                    lastModified: file.lastModified,
                                }));
                                
                                lastSizeRef.current = currentSize;
                                setLastUpdate(new Date());
                            }
                            // File grew - read only new content (incremental)
                            else if (currentSize > lastSizeRef.current) {
                                console.log(`File grew from ${lastSizeRef.current} to ${currentSize} bytes, reading increment`);
                                
                                // Read only the new part
                                const blob = await file.slice(lastSizeRef.current, currentSize).text();
                                
                                dispatch(appendLogContent({
                                    newContent: blob,
                                    newSize: currentSize,
                                    lastModified: file.lastModified,
                                }));
                                
                                lastSizeRef.current = currentSize;
                                setLastUpdate(new Date());
                            }
                            // Size same but modified timestamp changed - probably same content, skip
                            else {
                                console.log('File modified but size unchanged, skipping update');
                            }
                        }
                    } catch (error) {
                        console.error('Error reading file:', error);
                    }
                }, 1000); // Check every second

            } catch (error) {
                console.error('Error starting file monitoring:', error);
            }
        };

        startPolling();

        return () => {
            if (intervalId !== null) {
                window.clearInterval(intervalId);
            }
        };
    }, [isMonitoring, autoRefresh, hasFileHandle, dispatch]);

    const handleToggleAutoRefresh = () => {
        setAutoRefresh(prev => !prev);
    };

    const handleManualRefresh = async () => {
        const fileHandle = getFileHandle();
        if (!fileHandle) return;

        try {
            const file = await fileHandle.getFile();
            lastModifiedRef.current = file.lastModified;
            const newContent = await file.text();
            
            dispatch(updateLogContent({
                content: newContent,
                lastModified: file.lastModified,
            }));
            
            setLastUpdate(new Date());
        } catch (error) {
            console.error('Error refreshing file:', error);
        }
    };

    const handleReloadFile = () => {
        // Stop current monitoring and navigate back to home to select a new file
        dispatch(setMonitoringState(false));
        navigate(RouteHome);
    };

    const handleBackToHome = () => {
        navigate(RouteHome);
    };

    if (!isMonitoring) {
        return (
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    gap: 2,
                }}
            >
                <Typography variant="h5" gutterBottom>
                    No file selected
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Please select a log file from the Home page to start monitoring.
                </Typography>
                <Typography
                    variant="body2"
                    color="primary"
                    sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={handleBackToHome}
                >
                    Go to Home
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                gap: 2,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                    <Typography variant="h6">
                        {fileName}
                    </Typography>
                    {lastUpdate && (
                        <Typography variant="caption" color="text.secondary">
                            Last updated: {lastUpdate.toLocaleTimeString()}
                        </Typography>
                    )}
                </Box>
            </Box>

            <Alert severity="info" sx={{ mb: 1 }}>
                <Typography variant="body2">
                    <strong>Live Monitoring (Incremental Mode):</strong> 
                    {hasFileHandle ? (
                        <> The file is checked every second. Only new content is read for better performance.</>
                    ) : (
                        <> Automatic updates are not available. Use "Refresh Now" button to manually reload the file.</>
                    )}
                </Typography>
            </Alert>

            <Box sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={handleReloadFile}
                >
                    Change File
                </Typography>
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={handleManualRefresh}
                >
                    Refresh Now
                </Typography>
                <Chip 
                    label={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                    color={autoRefresh ? 'success' : 'default'}
                    onClick={handleToggleAutoRefresh}
                    size="small"
                    sx={{ cursor: 'pointer' }}
                />
                <Typography variant="caption" color="text.secondary">
                    Total lines: {parsedLines.length}
                </Typography>
                {newLinesCount > 0 && (
                    <Chip 
                        label={`+${newLinesCount} new`}
                        color="success"
                        size="small"
                        variant="outlined"
                        sx={{ 
                            animation: 'pulse 0.5s ease-in-out',
                            '@keyframes pulse': {
                                '0%': { transform: 'scale(1)' },
                                '50%': { transform: 'scale(1.1)' },
                                '100%': { transform: 'scale(1)' },
                            }
                        }}
                    />
                )}
            </Box>

            <TableContainer component={Paper} sx={{ flexGrow: 1, overflow: 'auto', backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f5f5f5', maxHeight: '70vh' }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: (theme) => theme.palette.background.paper }}>№</TableCell>
                            {Array.from(new Set(parsedLines.flatMap(row => row.parsed?.fields ? Object.keys(row.parsed.fields) : []))).map(field => (
                                <TableCell key={field} sx={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: (theme) => theme.palette.background.paper }}>{field}</TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {groupParsedLines(parsedLines).map((item, idx) => {
                            if (item.type === 'unparsed') {
                                return (
                                    <React.Fragment key={item.startLine}>
                                        <TableRow>
                                            <TableCell
                                                sx={{
                                                    width: 48,
                                                    p: 0,
                                                    textAlign: 'center',
                                                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#232323' : '#f7f7f7',
                                                    borderRight: '1px solid #e0e0e0',
                                                    cursor: 'pointer',
                                                    transition: 'background 0.2s',
                                                    '&:hover': {
                                                        backgroundColor: (theme) => theme.palette.action.hover,
                                                    },
                                                }}
                                                onClick={() => handleToggleGroup(item.startLine)}
                                            >
                                                <IconButton
                                                    aria-label="expand group"
                                                    size="small"
                                                    sx={{ m: 0, p: 0, pointerEvents: 'none' }}
                                                >
                                                    {openGroups[item.startLine] ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                                                </IconButton>
                                            </TableCell>
                                            <TableCell colSpan={item.allFields.length} sx={{ backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#232323' : '#f7f7f7' }}></TableCell>
                                        </TableRow>
                                        <TableRow>
                                            <TableCell colSpan={item.allFields.length + 1} sx={{ p: 0, border: 0, backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#232323' : '#f7f7f7' }}>
                                                <Collapse in={openGroups[item.startLine]} timeout="auto" unmountOnExit>
                                                    <Box sx={{ p: 1.5, fontFamily: 'monospace', fontSize: '0.95rem', color: 'text.secondary', backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#232323' : '#f7f7f7' }}>
                                                        {item.lines.map(l => (
                                                            <div
                                                                key={l.lineNumber}
                                                                style={{
                                                                    marginBottom: 2,
                                                                    cursor: 'pointer',
                                                                    background: selectedLine === l.lineNumber ? '#bbdefb' : 'none',
                                                                    borderRadius: selectedLine === l.lineNumber ? 4 : 0,
                                                                }}
                                                                onClick={() => setSelectedLine(l.lineNumber)}
                                                            >
                                                                {l.raw}
                                                            </div>
                                                        ))}
                                                    </Box>
                                                </Collapse>
                                            </TableCell>
                                        </TableRow>
                                    </React.Fragment>
                                );
                            }
                            // parsed
                            const row = item.line;
                            return (
                                <TableRow
                                    key={row.lineNumber}
                                    hover
                                    selected={selectedLine === row.lineNumber}
                                    onClick={() => setSelectedLine(row.lineNumber)}
                                    sx={{ cursor: 'pointer' }}
                                >
                                    <TableCell>{row.lineNumber}</TableCell>
                                    {item.allFields.map(field => (
                                        <TableCell key={field}>{row.parsed?.fields?.[field] ?? ''}</TableCell>
                                    ))}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
}

export default ViewLogsPage;