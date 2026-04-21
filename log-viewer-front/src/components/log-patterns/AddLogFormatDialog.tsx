import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import { useEffect, useMemo, useState } from 'react';
import { extractNamedGroups } from '../../utils/logFormatDetector';

type LogFormatFormPayload = {
    name: string;
    description: string;
    regex: string;
};

type HighlightRange = {
    start: number;
    end: number;
};

interface AddLogFormatDialogProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (payload: LogFormatFormPayload) => Promise<void> | void;
    initialValue?: Partial<LogFormatFormPayload>;
    title?: string;
    submitLabel?: string;
    previewLines?: string[];
}

const RECOMMENDED_FIELDS = [
    'timestamp',
    'datetime',
    'date',
    'time',
    'level',
    'message',
    'host',
    'class',
    'user',
    'ip',
    'status',
    'method',
];

const AddLogFormatDialog: React.FC<AddLogFormatDialogProps> = ({
    open,
    onClose,
    onSubmit,
    initialValue,
    title = 'Add Custom Log Format',
    submitLabel = 'Save',
    previewLines,
}) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [regex, setRegex] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [showHints, setShowHints] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }

        setName((initialValue?.name ?? '').trim());
        setDescription((initialValue?.description ?? '').trim());
        setRegex((initialValue?.regex ?? '').trim());
        setError(null);
        setSubmitting(false);
    }, [initialValue?.description, initialValue?.name, initialValue?.regex, open]);

    const regexValidation = useMemo(() => {
        const value = regex.trim();
        if (!value) {
            return {
                valid: false,
                error: 'Regular expression is required.',
                namedGroups: [] as string[],
                instance: null as RegExp | null,
                hasIndices: false,
            };
        }

        try {
            let instance: RegExp | null = null;
            let hasIndices = false;
            try {
                instance = new RegExp(value, 'md');
                hasIndices = true;
            } catch {
                instance = new RegExp(value, 'm');
                hasIndices = false;
            }
            const namedGroups = extractNamedGroups(value);

            if (namedGroups.length === 0) {
                return {
                    valid: false,
                    error: 'Use named capture groups, for example (?<timestamp>...) (?<level>...) (?<message>...).',
                    namedGroups,
                    instance: null,
                    hasIndices: false,
                };
            }

            return {
                valid: true,
                error: null,
                namedGroups,
                instance,
                hasIndices,
            };
        } catch {
            return {
                valid: false,
                error: 'Invalid regular expression.',
                namedGroups: [] as string[],
                instance: null as RegExp | null,
                hasIndices: false,
            };
        }
    }, [regex]);

    const recommendedMatches = useMemo(() => {
        const groups = new Set(regexValidation.namedGroups.map((group) => group.toLowerCase()));
        return RECOMMENDED_FIELDS.filter((field) => groups.has(field));
    }, [regexValidation.namedGroups]);

    const previewRows = useMemo(() => {
        const lines = (previewLines ?? []).slice(0, 5);
        const compiled = regexValidation.instance;
        const hasIndices = regexValidation.hasIndices;

        return lines.map((line, index) => {
            if (!compiled) {
                return {
                    index,
                    line,
                    matched: false,
                    fields: {} as Record<string, string>,
                    ranges: [] as HighlightRange[],
                };
            }

            try {
                const match = compiled.exec(line);
                const groups = match?.groups ?? {};
                const ranges: HighlightRange[] = [];

                if (match && hasIndices) {
                    const indicesGroups = (match as unknown as { indices?: { groups?: Record<string, [number, number]> } })
                        .indices?.groups;
                    if (indicesGroups) {
                        Object.values(indicesGroups).forEach((range) => {
                            if (Array.isArray(range) && range.length === 2) {
                                const [start, end] = range;
                                if (start >= 0 && end > start) {
                                    ranges.push({ start, end });
                                }
                            }
                        });
                    }
                }

                if (match && ranges.length === 0) {
                    let searchFrom = 0;
                    Object.values(groups).forEach((value) => {
                        if (!value) return;
                        const idx = line.indexOf(value, searchFrom);
                        if (idx >= 0) {
                            ranges.push({ start: idx, end: idx + value.length });
                            searchFrom = idx + value.length;
                        }
                    });
                }

                const normalizedRanges = ranges
                    .filter((range) => range.end > range.start)
                    .sort((a, b) => a.start - b.start)
                    .reduce<HighlightRange[]>((acc, range) => {
                        const last = acc[acc.length - 1];
                        if (!last || range.start > last.end) {
                            acc.push(range);
                        } else {
                            last.end = Math.max(last.end, range.end);
                        }
                        return acc;
                    }, []);

                return {
                    index,
                    line,
                    matched: Boolean(match && Object.keys(groups).length > 0),
                    fields: groups,
                    ranges: normalizedRanges,
                };
            } catch {
                return {
                    index,
                    line,
                    matched: false,
                    fields: {} as Record<string, string>,
                    ranges: [] as HighlightRange[],
                };
            }
        });
    }, [previewLines, regexValidation.instance, regexValidation.hasIndices]);

    const renderHighlightedLine = (line: string, ranges: HighlightRange[]) => {
        if (ranges.length === 0) {
            return line;
        }

        const parts: Array<{ text: string; highlight: boolean }> = [];
        let cursor = 0;

        ranges.forEach((range) => {
            if (range.start > cursor) {
                parts.push({ text: line.slice(cursor, range.start), highlight: false });
            }
            parts.push({ text: line.slice(range.start, range.end), highlight: true });
            cursor = range.end;
        });

        if (cursor < line.length) {
            parts.push({ text: line.slice(cursor), highlight: false });
        }

        return parts.map((part, idx) => (
            <Box
                key={`${idx}-${part.highlight ? 'h' : 'n'}`}
                component="span"
                sx={{
                    backgroundColor: part.highlight
                        ? (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 202, 40, 0.2)' : 'rgba(255, 235, 59, 0.35)'
                        : 'transparent',
                    borderRadius: part.highlight ? 0.5 : 0,
                    px: part.highlight ? 0.25 : 0,
                }}
            >
                {part.text}
            </Box>
        ));
    };

    const resetAndClose = () => {
        setName('');
        setDescription('');
        setRegex('');
        setError(null);
        setSubmitting(false);
        onClose();
    };

    const handleSubmit = async () => {
        setError(null);
        if (!name.trim() || !regex.trim()) {
            setError('Name and regular expression are required.');
            return;
        }

        if (!regexValidation.valid) {
            setError(regexValidation.error);
            return;
        }

        try {
            setSubmitting(true);
            await onSubmit({
                name: name.trim(),
                description: description.trim(),
                regex: regex.trim(),
            });
            resetAndClose();
        } catch (submitError) {
            const message = submitError instanceof Error ? submitError.message : 'Failed to save format.';
            setError(message);
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={resetAndClose}
            maxWidth="md"
            fullWidth
            PaperProps={{
                sx: {
                    maxWidth: 900,
                },
            }}
        >
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    label="Name"
                    fullWidth
                    value={name}
                    onChange={e => setName(e.target.value)}
                    sx={{ mb: 2 }}
                    disabled={submitting}
                />
                <TextField
                    margin="dense"
                    label="Description"
                    fullWidth
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    sx={{ mb: 2 }}
                    disabled={submitting}
                />
                <TextField
                    margin="dense"
                    label="Regular Expression"
                    fullWidth
                    multiline
                    minRows={2}
                    value={regex}
                    onChange={e => setRegex(e.target.value)}
                    sx={{ mb: 2 }}
                    placeholder={"e.g. ^(?<date>\\d{4}-\\d{2}-\\d{2}) (?<level>\\w+) (?<msg>.+)$"}
                    disabled={submitting}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
                    <Button
                        size="small"
                        variant={showHints ? 'contained' : 'outlined'}
                        onClick={() => setShowHints((prev) => !prev)}
                    >
                        {showHints ? 'Скрыть подсказку' : 'Подсказка'}
                    </Button>
                </Box>

                {showHints && (
                    <Box
                        sx={{
                            mb: 2,
                            p: 1.5,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(148, 163, 184, 0.08)' : 'rgba(148, 163, 184, 0.12)',
                        }}
                    >
                        <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 600 }}>
                            Подсказки по регулярным выражениям
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                            Используйте именованные группы захвата: (?&lt;name&gt;...). Это нужно для подсветки и фильтров.
                        </Typography>
                        <Typography
                            variant="caption"
                            component="pre"
                            sx={{
                                fontFamily: 'monospace',
                                backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f5f5f5',
                                p: 1,
                                borderRadius: 0.5,
                                overflow: 'auto',
                                mb: 0.75,
                            }}
                        >
{`Пример:
^(?<timestamp>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})
\\s+(?<level>\\w+)
\\s+(?<message>.+)$`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Быстрые подсказки: \\d{4} — год, \\w+ — слово, .+ — все до конца строки.
                        </Typography>
                    </Box>
                )}
                <Typography
                    variant="caption"
                    color={recommendedMatches.length > 0 ? 'success.main' : 'warning.main'}
                    sx={{ display: 'block', mb: 2 }}
                >
                    {recommendedMatches.length > 0
                        ? `Detected recommended fields: ${recommendedMatches.join(', ')}`
                        : 'No recommended fields detected yet. Add at least message and one time field for better analytics.'}
                </Typography>

                {previewRows.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                        <Divider sx={{ mb: 1 }} />
                        <Typography
                            variant="subtitle2"
                            sx={{ mb: 1 }}
                        >
                            Preview parsing of first 5 lines
                        </Typography>

                        {!regexValidation.instance && regex.trim() ? (
                            <Box
                                sx={{
                                    p: 2,
                                    border: '1px solid',
                                    borderColor: 'warning.main',
                                    borderRadius: 1,
                                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 152, 0, 0.08)' : 'rgba(255, 152, 0, 0.04)',
                                }}
                            >
                                <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600, mb: 1 }}>
                                    Используйте именованные группы захвата
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    Вместо обычных групп () используйте именованные (?&lt;name&gt;...)
                                </Typography>
                                <Typography
                                    variant="caption"
                                    component="pre"
                                    sx={{
                                        fontFamily: 'monospace',
                                        display: 'block',
                                        backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f5f5f5',
                                        p: 1,
                                        borderRadius: 0.5,
                                        overflow: 'auto',
                                    }}
                                >
{`Пример:
^(?<timestamp>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})
\\s+(?<level>\\w+)
\\s+(?<message>.+)$`}
                                </Typography>
                            </Box>
                        ) : (
                            <Box sx={{ maxHeight: 260, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                                {previewRows.map((row) => (
                                    <Box
                                        key={row.index}
                                        sx={{ mb: 1.5, pb: 1.5, borderBottom: row.index < previewRows.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}
                                    >
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                fontFamily: 'monospace',
                                                whiteSpace: 'pre-wrap',
                                                wordBreak: 'break-word',
                                                mb: 0.5,
                                                color: Object.keys(row.fields).length > 0 ? 'text.primary' : 'text.secondary',
                                            }}
                                        >
                                            {renderHighlightedLine(row.line, row.ranges)}
                                        </Typography>
                                        {Object.keys(row.fields).length > 0 ? (
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                                                {Object.entries(row.fields).map(([key, value]) => (
                                                    <Box
                                                        key={key}
                                                        sx={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 0.5,
                                                            px: 1,
                                                            py: 0.25,
                                                            borderRadius: 0.5,
                                                            backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.16)' : 'rgba(25, 118, 210, 0.08)',
                                                            border: '1px solid',
                                                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.5)' : 'rgba(25, 118, 210, 0.5)',
                                                        }}
                                                    >
                                                        <Typography
                                                            variant="caption"
                                                            sx={{ fontWeight: 600, color: 'primary.main' }}
                                                        >
                                                            {key}:
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            sx={{ fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                            title={value}
                                                        >
                                                            {value}
                                                        </Typography>
                                                    </Box>
                                                ))}
                                            </Box>
                                        ) : (
                                            regexValidation.instance && (
                                                <Typography
                                                    variant="caption"
                                                    color="text.disabled"
                                                    sx={{ fontStyle: 'italic', mt: 0.5, display: 'block' }}
                                                >
                                                    Нет совпадений
                                                </Typography>
                                            )
                                        )}
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                )}

                {error && (
                    <Typography
                        color="error"
                        variant="body2"
                        sx={{ mt: 1 }}
                    >
                        {error}
                    </Typography>
                )}
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={resetAndClose}
                    color="secondary"
                    disabled={submitting}
                >Cancel
                </Button>
                <Button
                    onClick={() => void handleSubmit()}
                    color="primary"
                    variant="contained"
                    disabled={submitting}
                >{submitLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AddLogFormatDialog;
