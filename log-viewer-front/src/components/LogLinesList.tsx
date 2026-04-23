import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { type FC, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { parseLogLineAuto } from '../utils/logFormatDetector';

type ParsedLinePreview = {
    formatId: string;
    fields: Record<string, string>;
    fieldOrder: string[];
};

type ParseState = 'parsed' | 'unparsed' | 'loading';

type HighlightCategory =
    | 'plain'
    | 'separator'
    | 'timestamp'
    | 'identifier'
    | 'numeric'
    | 'level-error'
    | 'level-warning'
    | 'level-info'
    | 'level-debug'
    | 'message';

type HighlightSegment = {
    text: string;
    category: HighlightCategory;
};

type SearchChunk = {
    text: string;
    isMatch: boolean;
};

const LEVEL_ERROR_VALUES = new Set(['fatal', 'error', 'err', 'critical', 'crit', 'panic', 'alert']);
const LEVEL_WARNING_VALUES = new Set(['warn', 'warning']);
const LEVEL_INFO_VALUES = new Set(['info', 'notice']);
const LEVEL_DEBUG_VALUES = new Set(['debug', 'trace', 'verbose']);

const classifyField = (fieldName: string, value: string): HighlightCategory => {
    const name = fieldName.toLowerCase();
    const normalizedValue = value.trim().toLowerCase();

    if (/(timestamp|datetime|date|time|month|day|year|ms|msec|millisecond)/.test(name)) {
        return 'timestamp';
    }

    if (/(level|severity|priority|status)/.test(name)) {
        if (LEVEL_ERROR_VALUES.has(normalizedValue)) return 'level-error';
        if (LEVEL_WARNING_VALUES.has(normalizedValue)) return 'level-warning';
        if (LEVEL_INFO_VALUES.has(normalizedValue)) return 'level-info';
        if (LEVEL_DEBUG_VALUES.has(normalizedValue)) return 'level-debug';
        return 'level-info';
    }

    if (/(count|size|bytes|duration|pid|thread|code|port|attempt|retry|index|line|id|offset)/.test(name)) {
        return 'numeric';
    }

    if (/(message|msg|text|detail|description|reason)/.test(name)) {
        return 'message';
    }

    if (/(host|node|ip|class|logger|service|component|module|process|method|user)/.test(name)) {
        return 'identifier';
    }

    if (/^-?\d+(?:[.,]\d+)?$/.test(normalizedValue)) {
        return 'numeric';
    }

    return 'identifier';
};

const buildSegments = (raw: string, parsed: ParsedLinePreview): HighlightSegment[] => {
    const fieldOrder = parsed.fieldOrder.length > 0 ? parsed.fieldOrder : Object.keys(parsed.fields);
    const segments: HighlightSegment[] = [];
    let cursor = 0;
    let hasColoredTokens = false;

    for (const fieldName of fieldOrder) {
        const value = parsed.fields[fieldName];
        if (!value) {
            continue;
        }

        const start = raw.indexOf(value, cursor);
        if (start < 0) {
            continue;
        }

        if (start > cursor) {
            segments.push({
                text: raw.slice(cursor, start),
                category: 'separator',
            });
        }

        segments.push({
            text: value,
            category: classifyField(fieldName, value),
        });
        hasColoredTokens = true;
        cursor = start + value.length;
    }

    if (cursor < raw.length) {
        segments.push({
            text: raw.slice(cursor),
            category: hasColoredTokens ? 'message' : 'plain',
        });
    }

    if (segments.length === 0) {
        return [{ text: raw, category: 'plain' }];
    }

    return segments;
};

const getSegmentColor = (category: HighlightCategory, isDarkMode: boolean): string => {
    const palette = isDarkMode
        ? {
            plain: '#e6edf3',
            separator: '#8b949e',
            timestamp: '#79c0ff',
            identifier: '#7ee787',
            numeric: '#d2a8ff',
            'level-error': '#ff7b72',
            'level-warning': '#e3b341',
            'level-info': '#58a6ff',
            'level-debug': '#7ee787',
            message: '#e6edf3',
        }
        : {
            plain: '#1f2328',
            separator: '#57606a',
            timestamp: '#0969da',
            identifier: '#116329',
            numeric: '#8250df',
            'level-error': '#cf222e',
            'level-warning': '#9a6700',
            'level-info': '#0969da',
            'level-debug': '#116329',
            message: '#24292f',
        };

    return palette[category];
};

const splitBySearchTerm = (text: string, normalizedSearchTerm: string): SearchChunk[] => {
    if (!normalizedSearchTerm) {
        return [{ text, isMatch: false }];
    }

    const normalizedText = text.toLowerCase();
    const chunks: SearchChunk[] = [];
    let cursor = 0;

    while (cursor < text.length) {
        const foundAt = normalizedText.indexOf(normalizedSearchTerm, cursor);
        if (foundAt < 0) {
            if (cursor < text.length) {
                chunks.push({ text: text.slice(cursor), isMatch: false });
            }
            break;
        }

        if (foundAt > cursor) {
            chunks.push({ text: text.slice(cursor, foundAt), isMatch: false });
        }

        const end = foundAt + normalizedSearchTerm.length;
        chunks.push({ text: text.slice(foundAt, end), isMatch: true });
        cursor = end;
    }

    return chunks.length > 0 ? chunks : [{ text, isMatch: false }];
};

const resolveLineParsing = (row: DisplayLine): { parseState: ParseState; parsedMeta?: ParsedLinePreview } => {
    if (row.parseState === 'parsed' && row.parsedMeta) {
        return { parseState: 'parsed', parsedMeta: row.parsedMeta };
    }

    if (row.parseState === 'loading') {
        return { parseState: 'loading' };
    }

    if (row.parseState === 'unparsed') {
        return { parseState: 'unparsed' };
    }

    const parsed = parseLogLineAuto(row.raw);
    if (!parsed) {
        return { parseState: 'unparsed' };
    }

    return {
        parseState: 'parsed',
        parsedMeta: {
            formatId: parsed.formatId,
            fields: parsed.fields,
            fieldOrder: Object.keys(parsed.fields),
        },
    };
};

interface DisplayLine {
    displayLineNumber: number;
    sourceLineNumber?: number;
    raw: string;
    anomalyStatus?: 'anomaly' | 'normal';
    parsedMeta?: ParsedLinePreview;
    parseState?: ParseState;
}

interface LogLinesListProps {
    displayLines?: DisplayLine[];
    totalCount?: number;
    getLineAtIndex?: (index: number) => DisplayLine | null;
    onRangeChange?: (startIndex: number, endIndex: number) => void;
    globalSearchTerm?: string | null;
    selectedLine: number | null;
    onSelectLine: (lineNumber: number) => void;
    virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const LogLinesList: FC<LogLinesListProps> = ({
    displayLines,
    totalCount,
    getLineAtIndex,
    onRangeChange,
    globalSearchTerm,
    selectedLine,
    onSelectLine,
    virtuosoRef,
}) => {
    const { t } = useTranslation();
    const resolvedTotalCount = totalCount ?? displayLines?.length ?? 0;
    const normalizedGlobalSearchTerm = (globalSearchTerm ?? '').trim().toLowerCase();

    return (
        <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%', width: '100%' }}
            totalCount={resolvedTotalCount}
            overscan={200}
            fixedItemHeight={20}
            rangeChanged={(range) => {
                if (onRangeChange) {
                    onRangeChange(range.startIndex, range.endIndex);
                }
            }}
            computeItemKey={(index) => {
                const row = getLineAtIndex ? getLineAtIndex(index) : displayLines?.[index];
                return row?.displayLineNumber || index;
            }}
            itemContent={(index) => {
                const row = getLineAtIndex ? getLineAtIndex(index) : displayLines?.[index];
                if (!row) {
                    return null;
                }

                const parsing = resolveLineParsing(row);
                const highlightSegments = parsing.parseState === 'parsed' && parsing.parsedMeta
                    ? buildSegments(row.raw, parsing.parsedMeta)
                    : null;

                return (
                    <Box
                        sx={{
                            display: 'flex',
                            height: '20px',
                            alignItems: 'center',
                            px: 2,
                            cursor: 'pointer',
                            backgroundColor: (theme) => selectedLine === (row.sourceLineNumber ?? row.displayLineNumber)
                                ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.16)
                                : 'transparent',
                            '&:hover': {
                                backgroundColor: selectedLine === (row.sourceLineNumber ?? row.displayLineNumber)
                                    ? ((theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.16))
                                    : (theme) => theme.palette.action.hover,
                            },
                        }}
                        onClick={() => onSelectLine(row.sourceLineNumber ?? row.displayLineNumber)}
                    >
                        <Typography
                            variant="body2"
                            sx={{
                                minWidth: '80px',
                                color: 'text.secondary',
                                fontFamily: 'monospace',
                                fontSize: '0.8rem',
                                lineHeight: '20px',
                                userSelect: 'none',
                                flexShrink: 0,
                            }}
                        >
                            {row.displayLineNumber}
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{
                                minWidth: '72px',
                                color: row.anomalyStatus === 'anomaly'
                                    ? '#d81b60'
                                    : row.anomalyStatus === 'normal'
                                        ? 'text.secondary'
                                        : 'text.disabled',
                                fontWeight: row.anomalyStatus === 'anomaly' ? 700 : 400,
                                fontFamily: 'monospace',
                                fontSize: '0.75rem',
                                lineHeight: '20px',
                                userSelect: 'none',
                                mr: 2,
                                flexShrink: 0,
                            }}
                        >
                            {row.anomalyStatus === 'anomaly'
                                ? t('viewLogs.lines.anomalyStatus.anomaly')
                                : row.anomalyStatus === 'normal'
                                    ? t('viewLogs.lines.anomalyStatus.normal')
                                    : t('viewLogs.lines.anomalyStatus.undefined')}
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.8rem',
                                lineHeight: '20px',
                                flex: 1,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: parsing.parseState === 'unparsed' ? 'text.disabled' : 'text.primary',
                            }}
                        >
                            {highlightSegments
                                ? highlightSegments.map((segment, segmentIndex) => (
                                    <Box
                                        component="span"
                                        key={`${row.displayLineNumber}-${segmentIndex}-${segment.category}`}
                                        sx={(theme) => ({
                                            color: getSegmentColor(segment.category, theme.palette.mode === 'dark'),
                                        })}
                                    >
                                        {normalizedGlobalSearchTerm
                                            ? splitBySearchTerm(segment.text, normalizedGlobalSearchTerm).map((chunk, chunkIndex) => (
                                                <Box
                                                    component="span"
                                                    key={`${row.displayLineNumber}-${segmentIndex}-${chunkIndex}-${chunk.isMatch ? 'match' : 'text'}`}
                                                    sx={chunk.isMatch
                                                        ? (theme) => ({
                                                            backgroundColor: theme.palette.mode === 'dark'
                                                                ? 'rgba(255, 235, 59, 0.35)'
                                                                : 'rgba(255, 235, 59, 0.7)',
                                                            borderRadius: '2px',
                                                        })
                                                        : undefined}
                                                >
                                                    {chunk.text}
                                                </Box>
                                            ))
                                            : segment.text}
                                    </Box>
                                ))
                                : (
                                    normalizedGlobalSearchTerm
                                        ? splitBySearchTerm(row.raw, normalizedGlobalSearchTerm).map((chunk, chunkIndex) => (
                                            <Box
                                                component="span"
                                                key={`${row.displayLineNumber}-raw-${chunkIndex}-${chunk.isMatch ? 'match' : 'text'}`}
                                                sx={chunk.isMatch
                                                    ? (theme) => ({
                                                        backgroundColor: theme.palette.mode === 'dark'
                                                            ? 'rgba(255, 235, 59, 0.35)'
                                                            : 'rgba(255, 235, 59, 0.7)',
                                                        borderRadius: '2px',
                                                    })
                                                    : undefined}
                                            >
                                                {chunk.text}
                                            </Box>
                                        ))
                                        : row.raw
                                )}
                        </Typography>
                    </Box>
                );
            }}
        />
    );
};

export default LogLinesList;
