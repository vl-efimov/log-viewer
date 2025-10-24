import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../redux/store';
import { useEffect, useState } from 'react';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DeleteIcon from '@mui/icons-material/Delete';
import { getAllFiles, getAllLogs, deleteFile, FileInfo, LogLine } from '../utils/logDb';
import { setLogFile, clearLogFile } from '../redux/slices/logFileSlice';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

const VSCODE_BLUE = '#007acc';
const VSCODE_TEXT = '#fff';

const AppStatusBar: React.FC = () => {
    const logFile = useSelector((state: RootState) => state.logFile);
    const dispatch = useDispatch();
    const [files, setFiles] = useState<FileInfo[]>([]);
    const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [memUsedMB, setMemUsedMB] = useState<number | null>(null);
    const [memMaxMB, setMemMaxMB] = useState<number | null>(null);
    const [memEstimateMB, setMemEstimateMB] = useState<number | null>(null);

    function loadThresholds() {
        const defaults = { green: 800, yellow: 1200 };
        try {
            const raw = localStorage.getItem('memThresholds');
            if (!raw) return defaults;
            const parsed = JSON.parse(raw);
            const green = typeof parsed?.green === 'number' && parsed.green > 0 ? parsed.green : defaults.green;
            const yellow = typeof parsed?.yellow === 'number' && parsed.yellow > 0 ? parsed.yellow : defaults.yellow;
            return { green, yellow };
        } catch {
            return defaults;
        }
    }

    useEffect(() => {
        let mounted = true;
        const estimateHistory: number[] = [];
        function readMemory() {
            try {
                // performance.memory is non-standard and may be undefined
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const perf: any = (performance as any);

                // read base JS heap usage
                const usedHeapMB = perf && perf.memory && typeof perf.memory.usedJSHeapSize === 'number'
                    ? perf.memory.usedJSHeapSize / (1024 * 1024)
                    : 0;

                // heuristic estimates for DOM/images/content
                const domEstimateMB = estimateDOMMemoryMB();
                const imagesEstimateMB = estimateImagesMemoryMB();
                const contentEstimateMB = estimateContentMemoryMB();

                let approx = usedHeapMB + domEstimateMB + imagesEstimateMB + contentEstimateMB;
                approx = approx * 1.12; // small overhead factor

                // smoothing: keep last 5 samples
                estimateHistory.push(approx);
                if (estimateHistory.length > 5) estimateHistory.shift();
                const avg = estimateHistory.reduce((a, b) => a + b, 0) / estimateHistory.length;

                // determine denominator: prefer local override (memMaxOverride) or default 1200
                const raw = localStorage.getItem('memMaxOverride');
                const n = raw ? parseInt(raw, 10) : NaN;
                const maxMB = Number.isFinite(n) && n > 0 ? n : 1200;

                if (mounted) {
                    setMemEstimateMB(Math.round(avg));
                    setMemUsedMB(Math.round(approx));
                    setMemMaxMB(Math.round(maxMB));
                }
            } catch {
                if (mounted) {
                    setMemEstimateMB(null);
                    setMemUsedMB(null);
                    setMemMaxMB(null);
                }
            }
        }

        readMemory();
        const id = window.setInterval(readMemory, 2000);
        return () => {
            mounted = false;
            window.clearInterval(id);
        };
    }, []);

    // Listen for external 'file-added' events to auto-select newly added file
    useEffect(() => {
        const handler = async (ev: Event) => {
            try {
                const detail = (ev as CustomEvent).detail as { id?: number } | undefined;
                if (detail && typeof detail.id === 'number') {
                    await selectFile(detail.id);
                }
            } catch {
                // ignore
            }
        };
        window.addEventListener('logviewer:file-added', handler as EventListener);
        return () => window.removeEventListener('logviewer:file-added', handler as EventListener);
    // selectFile is stable (function defined in component) - no deps
    }, []);
    const { green: THRESHOLD_GREEN, yellow: THRESHOLD_YELLOW } = loadThresholds();
    const memValueForColor = memEstimateMB ?? memUsedMB;
    const memColor = memValueForColor === null
        ? 'gray'
        : ( memValueForColor < THRESHOLD_GREEN
            ? '#4caf50'
            : ( memValueForColor < THRESHOLD_YELLOW
                ? '#ffeb3b'
                : '#f44336') );

    // helpers for estimating tab memory
    function estimateDOMMemoryMB(): number {
        try {
            const nodeCount = document.getElementsByTagName('*').length;
            const avgBytesPerNode = 800; // heuristic
            const bytes = nodeCount * avgBytesPerNode;
            return bytes / (1024 * 1024);
        } catch {
            return 0;
        }
    }

    useEffect(() => {
        let mounted = true;
        const initialSelectedRef = { current: false } as { current: boolean };
        const load = async () => {
            try {
                const all = await getAllFiles();
                if (!mounted) return;
                setFiles(all);
                if (all.length === 0) {
                    dispatch(clearLogFile());
                    setSelectedFileId(null);
                    return;
                }
                // Auto-select newest only once on initial load. Do not override user's manual selection later.
                if (!initialSelectedRef.current) {
                    if (selectedFileId === null) {
                        const newest = all.reduce((a, b) => (a.uploadedAt > b.uploadedAt ? a : b));
                        if (newest && newest.id != null) {
                            await selectFile(newest.id);
                        }
                    }
                    initialSelectedRef.current = true;
                }
            } catch (e) {
                console.error('Failed to load files', e);
            }
        };
        load();
        const id = window.setInterval(load, 3000);
        return () => { mounted = false; window.clearInterval(id); };
    }, []);

    const selectFile = async (fileId: number) => {
        try {
            const all = await getAllFiles();
            const info = all.find(f => f.id === fileId);
            if (!info) return;
            // load logs and reconstruct content
            const logs = await getAllLogs(info.id!);
            const lines = logs.map((l: LogLine) => {
                const maybe = (l as unknown as Record<string, unknown>)['line'];
                return typeof maybe === 'string' ? maybe : JSON.stringify(l);
            });
            const content = lines.join('\n');
            dispatch(setLogFile({ name: info.name, size: info.size, content, format: info.format }));
            setSelectedFileId(info.id ?? null);
            // refresh file list
            setFiles(all);
        } catch (err) {
            console.error('selectFile error', err);
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSelectChange = async (e: any) => {
        const id = Number(e.target.value as unknown as number);
        await selectFile(id);
    };

    const handleDelete = async () => {
        if (selectedFileId === null) return;
        try {
            await deleteFile(selectedFileId);
            // reload list
            const all = await getAllFiles();
            setFiles(all);
            if (all.length > 0) {
                await selectFile(all[0].id!);
            } else {
                dispatch(clearLogFile());
                setSelectedFileId(null);
            }
        } catch (err) {
            console.error('delete failed', err);
        }
    };

    const onRequestDelete = () => {
        if (selectedFileId === null) return;
        setConfirmOpen(true);
    };

    const onConfirmDelete = async () => {
        setConfirmOpen(false);
        await handleDelete();
    };

    const onCancelDelete = () => {
        setConfirmOpen(false);
    };

    function estimateImagesMemoryMB(): number {
        try {
            const imgs = Array.from(document.images) as HTMLImageElement[];
            let bytes = 0;
            for (const img of imgs) {
                const w = img.naturalWidth || 0;
                const h = img.naturalHeight || 0;
                bytes += w * h * 4; // RGBA
            }
            return bytes / (1024 * 1024);
        } catch {
            return 0;
        }
    }

    function estimateContentMemoryMB(): number {
        try {
            // if the app stores the file content in Redux (string), approximate its size
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const lf: any = (window as any).__APP_LOG_FILE_CONTENT__;
            if (lf && typeof lf === 'string') {
                const bytes = lf.length * 2; // approx UTF-16
                return bytes / (1024 * 1024);
            }
            return 0;
        } catch {
            return 0;
        }
    }

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
                    gap: 2
                }}
            >
                {(() => {
                    if (files.length === 0) {
                        return <Typography sx={{ color: VSCODE_TEXT }}>Нет файлов</Typography>;
                    }
                    return (
                        <>
                            <Select
                                value={selectedFileId ?? ''}
                                onChange={handleSelectChange}
                                size="small"
                                sx={{ color: VSCODE_TEXT, minWidth: 200 }}
                            >
                                {files.map(f => (
                                    <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
                                ))}
                            </Select>
                            <Typography sx={{ color: VSCODE_TEXT }}>
                                {`${(logFile.size / (1024 * 1024)).toFixed(2)} МБ`}
                            </Typography>
                            <Typography sx={{ color: VSCODE_TEXT }}>
                                {logFile.format === 'Unknown format' ? 'Unknown format' : logFile.format}
                            </Typography>
                            <Tooltip title="Удалить выбранный файл">
                                <IconButton size="small" onClick={onRequestDelete} sx={{ color: VSCODE_TEXT }}>
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </>
                    );
                })()}
            </Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                }}
            >
                <Typography sx={{ color: VSCODE_TEXT }}>
                    {(() => {
                        const display = memEstimateMB ?? memUsedMB;
                        if (display !== null && memMaxMB !== null) {
                            const pct = memMaxMB > 0 ? Math.round((display / memMaxMB) * 100) : 0;
                            return `Память: ${display} / ${memMaxMB} МБ (${pct}%)`;
                        }
                        if (display !== null) {
                            return `Память: ${display} МБ`;
                        }
                        return 'Память: N/A';
                    })()}
                </Typography>
                <Box
                    sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: memColor,
                    }}
                />
                <Typography sx={{ color: VSCODE_TEXT }}>
                    Готово
                </Typography>
            </Box>
            <Dialog
                open={confirmOpen}
                onClose={onCancelDelete}
                aria-labelledby="confirm-delete-title"
            >
                <DialogTitle id="confirm-delete-title">Подтвердите удаление</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {selectedFileId === null ? 'Нет выбранного файла.' : `Вы действительно хотите удалить файл "${files.find(f => f.id === selectedFileId)?.name ?? ''}"? Это действие необратимо.`}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onCancelDelete}>Отмена</Button>
                    <Button onClick={onConfirmDelete} color="error">Удалить</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default AppStatusBar;
