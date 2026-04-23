import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { useEffect, useMemo, useState } from 'react';
import { extractNamedGroups } from '../../utils/logFormatDetector';
import { useTranslation } from 'react-i18next';

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

type RegexValidationErrorCode =
    | 'required'
    | 'missing-named-groups'
    | 'duplicate-named-groups'
    | 'invalid-regex';

type RegexValidationResult = {
    valid: boolean;
    error: string | null;
    errorCode: RegexValidationErrorCode | null;
    namedGroups: string[];
    duplicateNamedGroups: string[];
    instance: RegExp | null;
    hasIndices: boolean;
};

const NAMED_GROUP_REGEX = /\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g;

const extractNamedGroupOccurrences = (regexSource: string): string[] => {
    const groups: string[] = [];
    let match: RegExpExecArray | null = NAMED_GROUP_REGEX.exec(regexSource);

    while (match) {
        groups.push(match[1]);
        match = NAMED_GROUP_REGEX.exec(regexSource);
    }

    NAMED_GROUP_REGEX.lastIndex = 0;

    return groups;
};

const extractDuplicateGroupNames = (groupNames: string[]): string[] => {
    const counts = new Map<string, number>();

    groupNames.forEach((name) => {
        counts.set(name, (counts.get(name) ?? 0) + 1);
    });

    return Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name);
};

const AddLogFormatDialog: React.FC<AddLogFormatDialogProps> = ({
    open,
    onClose,
    onSubmit,
    initialValue,
    title,
    submitLabel,
    previewLines,
}) => {
    const { t } = useTranslation();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [regex, setRegex] = useState('');
    const [nameError, setNameError] = useState<string | null>(null);
    const [regexError, setRegexError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [showHints, setShowHints] = useState(false);

    const resolvedTitle = title ?? t('logFormats.dialog.title');
    const resolvedSubmitLabel = submitLabel ?? t('logFormats.dialog.submit');

    useEffect(() => {
        if (!open) {
            return;
        }

        setName((initialValue?.name ?? '').trim());
        setDescription((initialValue?.description ?? '').trim());
        setRegex((initialValue?.regex ?? '').trim());
        setNameError(null);
        setRegexError(null);
        setSubmitError(null);
        setSubmitting(false);
    }, [initialValue?.description, initialValue?.name, initialValue?.regex, open]);

    const regexValidation = useMemo<RegexValidationResult>(() => {
        const value = regex.trim();
        if (!value) {
            return {
                valid: false,
                error: t('logFormats.dialog.validation.regexRequired'),
                errorCode: 'required',
                namedGroups: [] as string[],
                duplicateNamedGroups: [] as string[],
                instance: null as RegExp | null,
                hasIndices: false,
            };
        }

        const namedGroupOccurrences = extractNamedGroupOccurrences(value);
        const duplicateNamedGroups = extractDuplicateGroupNames(namedGroupOccurrences);

        if (duplicateNamedGroups.length > 0) {
            return {
                valid: false,
                error: t('logFormats.dialog.validation.duplicateNamedGroups', {
                    groups: duplicateNamedGroups.join(', '),
                }),
                errorCode: 'duplicate-named-groups',
                namedGroups: extractNamedGroups(value),
                duplicateNamedGroups,
                instance: null,
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
                    error: t('logFormats.dialog.validation.missingNamedGroups'),
                    errorCode: 'missing-named-groups',
                    namedGroups,
                    duplicateNamedGroups,
                    instance: null,
                    hasIndices: false,
                };
            }

            return {
                valid: true,
                error: null,
                errorCode: null,
                namedGroups,
                duplicateNamedGroups,
                instance,
                hasIndices,
            };
        } catch (error) {
            const details = error instanceof Error && error.message ? error.message : '';
            return {
                valid: false,
                error: details
                    ? t('logFormats.dialog.validation.invalidRegexWithDetails', { details })
                    : t('logFormats.dialog.validation.invalidRegex'),
                errorCode: 'invalid-regex',
                namedGroups: [] as string[],
                duplicateNamedGroups,
                instance: null as RegExp | null,
                hasIndices: false,
            };
        }
    }, [regex, t]);

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
        setNameError(null);
        setRegexError(null);
        setSubmitError(null);
        setSubmitting(false);
        onClose();
    };

    const handleSubmit = async () => {
        setNameError(null);
        setRegexError(null);
        setSubmitError(null);

        const trimmedName = name.trim();
        const trimmedRegex = regex.trim();

        let hasValidationError = false;
        if (!trimmedName) {
            setNameError(t('logFormats.dialog.validation.nameRequired'));
            hasValidationError = true;
        }

        if (!trimmedRegex) {
            setRegexError(t('logFormats.dialog.validation.regexRequired'));
            hasValidationError = true;
        }

        if (hasValidationError) {
            return;
        }

        if (!regexValidation.valid) {
            setRegexError(regexValidation.error ?? t('logFormats.dialog.validation.invalidRegex'));
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
            const message = submitError instanceof Error
                ? submitError.message
                : t('logFormats.dialog.errors.saveFailed');
            setSubmitError(message);
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={resetAndClose}
            maxWidth={false}
            fullWidth
            PaperProps={{
                sx: {
                    width: { xs: 'calc(100vw - 16px)', sm: '94vw' },
                    maxWidth: { xs: 'calc(100vw - 16px)', sm: '94vw' },
                    height: { xs: 'calc(100vh - 16px)', sm: '92vh' },
                    maxHeight: { xs: 'calc(100vh - 16px)', sm: '92vh' },
                    m: { xs: 1, sm: 2 },
                },
            }}
        >
            <DialogTitle sx={{ pr: 6 }}>
                {resolvedTitle}
                <IconButton
                    aria-label={t('common.closeAria')}
                    onClick={resetAndClose}
                    size="small"
                    sx={{ position: 'absolute', right: 8, top: 8 }}
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent sx={{ overflowY: 'auto' }}>
                <TextField
                    autoFocus
                    margin="dense"
                    label={t('logFormats.dialog.fields.name')}
                    fullWidth
                    value={name}
                    onChange={e => {
                        setName(e.target.value);
                        if (nameError) {
                            setNameError(null);
                        }
                    }}
                    sx={{ mb: 2 }}
                    disabled={submitting}
                    error={Boolean(nameError)}
                    helperText={nameError}
                />
                <TextField
                    margin="dense"
                    label={t('logFormats.dialog.fields.description')}
                    fullWidth
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    sx={{ mb: 2 }}
                    disabled={submitting}
                />
                <TextField
                    margin="dense"
                    label={t('logFormats.dialog.fields.regex')}
                    fullWidth
                    multiline
                    minRows={2}
                    value={regex}
                    onChange={e => {
                        setRegex(e.target.value);
                        if (regexError) {
                            setRegexError(null);
                        }
                        if (submitError) {
                            setSubmitError(null);
                        }
                    }}
                    sx={{ mb: 2 }}
                    placeholder={t('logFormats.dialog.fields.regexPlaceholder')}
                    disabled={submitting}
                    error={Boolean(regexError) || Boolean(submitError)}
                    helperText={regexError ?? submitError}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
                    <Button
                        size="small"
                        variant={showHints ? 'contained' : 'outlined'}
                        onClick={() => setShowHints((prev) => !prev)}
                    >
                        {showHints ? t('logFormats.dialog.hints.toggleHide') : t('logFormats.dialog.hints.toggleShow')}
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
                            {t('logFormats.dialog.hints.title')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                            {t('logFormats.dialog.hints.namedGroups')}
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
    {`${t('logFormats.dialog.hints.exampleLabel')}
^(?<timestamp>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})
\\s+(?<level>\\w+)
\\s+(?<message>.+)$`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {t('logFormats.dialog.hints.quick')}
                        </Typography>
                    </Box>
                )}
                <Typography
                    variant="caption"
                    color={recommendedMatches.length > 0 ? 'success.main' : 'warning.main'}
                    sx={{ display: 'block', mb: 2 }}
                >
                    {recommendedMatches.length > 0
                        ? t('logFormats.dialog.recommended.detected', { fields: recommendedMatches.join(', ') })
                        : t('logFormats.dialog.recommended.missing')}
                </Typography>

                {previewRows.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                        <Divider sx={{ mb: 1 }} />
                        <Typography
                            variant="subtitle2"
                            sx={{ mb: 1 }}
                        >
                            {t('logFormats.dialog.preview.title')}
                        </Typography>

                        {regexValidation.errorCode === 'missing-named-groups' && regex.trim() ? (
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
                                    {t('logFormats.dialog.preview.useNamedGroupsTitle')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    {t('logFormats.dialog.preview.useNamedGroupsBody')}
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
{`${t('logFormats.dialog.hints.exampleLabel')}
^(?<timestamp>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})
\\s+(?<level>\\w+)
\\s+(?<message>.+)$`}
                                </Typography>
                            </Box>
                        ) : regexValidation.errorCode === 'duplicate-named-groups' && regex.trim() ? (
                            <Box
                                sx={{
                                    p: 2,
                                    border: '1px solid',
                                    borderColor: 'error.main',
                                    borderRadius: 1,
                                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(244, 67, 54, 0.10)' : 'rgba(244, 67, 54, 0.06)',
                                }}
                            >
                                <Typography variant="body2" color="error.main" sx={{ fontWeight: 600, mb: 1 }}>
                                    {t('logFormats.dialog.preview.duplicateGroupsTitle')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    {t('logFormats.dialog.preview.duplicateGroupsBody')}
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
                                        mb: 1,
                                    }}
                                >
                                    {regexValidation.duplicateNamedGroups.join(', ')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {t('logFormats.dialog.preview.duplicateGroupsExample')}
                                </Typography>
                            </Box>
                        ) : regexValidation.errorCode === 'invalid-regex' && regex.trim() ? (
                            <Box
                                sx={{
                                    p: 2,
                                    border: '1px solid',
                                    borderColor: 'error.main',
                                    borderRadius: 1,
                                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(244, 67, 54, 0.10)' : 'rgba(244, 67, 54, 0.06)',
                                }}
                            >
                                <Typography variant="body2" color="error.main" sx={{ fontWeight: 600, mb: 0.75 }}>
                                    {t('logFormats.dialog.preview.invalidRegexTitle')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {regexValidation.error ?? t('logFormats.dialog.validation.invalidRegex')}
                                </Typography>
                            </Box>
                        ) : (
                            <Box
                                sx={{
                                    maxHeight: { xs: '28vh', sm: '40vh' },
                                    overflowY: 'auto',
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderRadius: 1,
                                    p: 1,
                                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : 'transparent',
                                }}
                            >
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
                                                    {t('logFormats.dialog.preview.noMatches')}
                                                </Typography>
                                            )
                                        )}
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={resetAndClose}
                    disabled={submitting}
                >
                    {t('common.cancel')}
                </Button>
                <Button
                    onClick={() => void handleSubmit()}
                    color="primary"
                    variant="contained"
                    disabled={submitting}
                >
                    {resolvedSubmitLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AddLogFormatDialog;
