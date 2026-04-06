import { parseLogLineAuto, type ParsedLogLine } from './logFormatDetector';
import type { HistogramLine, LargeFileAggregateStats } from './histogramSampling';
import {
    type LogFieldIndexRecord,
    type LogLineRecord,
    type LogSessionRecord,
    createLogSessionId,
    putLineBatch,
    saveDashboardSnapshot,
    upsertSession,
} from './logIndexedDb';

const INDEX_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB
const BATCH_LINES = 1000;
const MAX_HISTOGRAM_SAMPLE_LINES = 50_000;
const MAX_TRACKED_FIELDS = 16;
const MAX_UNIQUE_VALUES_PER_FIELD = 500;

const PRIORITY_AGG_FIELDS = new Set([
    'level',
    'status',
    'method',
    'queue',
    'type',
    'component',
    'host',
    'user',
    'class',
    'ip',
]);

const EXCLUDED_AGG_FIELDS = new Set([
    'message',
    'timestamp',
    'datetime',
    'date',
    'time',
]);

export type IndexingProgress = {
    processedBytes: number;
    totalBytes: number;
    linesIndexed: number;
};

export type IndexingResult = {
    sessionId: string;
    lineCount: number;
    stats: LargeFileAggregateStats;
    sampledLines: HistogramLine[];
};

export type IndexingOptions = {
    onProgress?: (progress: IndexingProgress) => void;
    signal?: AbortSignal;
};

const activeIndexers = new Map<string, AbortController>();
const cancelledSessions = new Set<string>();

export const registerIndexingController = (sessionId: string, controller: AbortController) => {
    activeIndexers.set(sessionId, controller);
};

export const clearIndexingController = (sessionId: string) => {
    activeIndexers.delete(sessionId);
};

export const cancelIndexing = (sessionId: string) => {
    cancelledSessions.add(sessionId);
    const controller = activeIndexers.get(sessionId);
    if (controller) {
        controller.abort();
        activeIndexers.delete(sessionId);
    }
};

const isContinuationLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }

    return (
        /^\s+at\s+/.test(line)
        || /^\s*\.\.\.\s+\d+\s+more$/.test(trimmed)
        || /^\s*Caused by:/.test(trimmed)
        || /^\s*Traceback\s+\(most recent call last\):/.test(trimmed)
    );
};

const parseTimestamp = (timestamp: string): Date | null => {
    if (!timestamp) return null;

    const directParse = new Date(timestamp);
    if (!Number.isNaN(directParse.getTime())) {
        return directParse;
    }

    const hdfsMatch = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})[,.](\d{3})?/);
    if (hdfsMatch) {
        const [, year, month, day, hour, min, sec, ms] = hdfsMatch;
        return new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(min, 10),
            parseInt(sec, 10),
            parseInt(ms || '0', 10)
        );
    }

    const apacheMatch = timestamp.match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/);
    if (apacheMatch) {
        const [, month, day, hour, min, sec, year] = apacheMatch;
        const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
        if (monthIndex >= 0) {
            return new Date(parseInt(year, 10), monthIndex, parseInt(day, 10), parseInt(hour, 10), parseInt(min, 10), parseInt(sec, 10));
        }
    }

    const accessMatch = timestamp.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
    if (accessMatch) {
        const [, day, month, year, hour, min, sec] = accessMatch;
        const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
        if (monthIndex >= 0) {
            return new Date(parseInt(year, 10), monthIndex, parseInt(day, 10), parseInt(hour, 10), parseInt(min, 10), parseInt(sec, 10));
        }
    }

    const bglOldMatch = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})\.(\d{2})\.(\d{2})\.(\d{1,6})$/);
    if (bglOldMatch) {
        const [, year, month, day, hour, min, sec, micros] = bglOldMatch;
        const ms = Math.floor(parseInt(micros.padEnd(6, '0').slice(0, 6), 10) / 1000);
        return new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(min, 10),
            parseInt(sec, 10),
            ms
        );
    }

    return null;
};

const extractTimestampMs = (parsed: ParsedLogLine | null): number | null => {
    if (!parsed) return null;

    const directCandidates = [parsed.fields.timestamp, parsed.fields.datetime];

    for (const candidate of directCandidates) {
        if (!candidate) continue;
        const ts = parseTimestamp(candidate);
        if (ts) {
            return ts.getTime();
        }
    }

    if (parsed.fields.date && parsed.fields.time) {
        const msPart = parsed.fields.milliseconds || parsed.fields.ms;
        const combined = msPart
            ? `${parsed.fields.date} ${parsed.fields.time},${msPart}`
            : `${parsed.fields.date} ${parsed.fields.time}`;
        const ts = parseTimestamp(combined);
        if (ts) {
            return ts.getTime();
        }
    }

    if (parsed.fields.date) {
        const ts = parseTimestamp(parsed.fields.date);
        if (ts) {
            return ts.getTime();
        }
    }

    return null;
};

const normalizeFieldValue = (value: string | undefined): string | null => {
    if (!value) return null;
    const normalized = value.trim();
    if (!normalized || normalized === '-' || normalized === 'null' || normalized === 'undefined') {
        return null;
    }
    return normalized;
};

const canTrackField = (
    field: string,
    fieldValueCounts: Record<string, Record<string, number>>
): boolean => {
    if (EXCLUDED_AGG_FIELDS.has(field)) {
        return false;
    }

    if (fieldValueCounts[field]) {
        return true;
    }

    if (PRIORITY_AGG_FIELDS.has(field)) {
        return true;
    }

    return Object.keys(fieldValueCounts).length < MAX_TRACKED_FIELDS;
};

const addFieldValue = (
    field: string,
    rawValue: string | undefined,
    fieldValueCounts: Record<string, Record<string, number>>,
    fieldUniqueCounts: Record<string, number>
) => {
    const normalized = normalizeFieldValue(rawValue);
    if (!normalized) {
        return;
    }

    if (!canTrackField(field, fieldValueCounts)) {
        return;
    }

    if (!fieldValueCounts[field]) {
        fieldValueCounts[field] = {};
        fieldUniqueCounts[field] = 0;
    }

    const fieldMap = fieldValueCounts[field];
    if (fieldMap[normalized] === undefined) {
        if (fieldUniqueCounts[field] >= MAX_UNIQUE_VALUES_PER_FIELD) {
            return;
        }
        fieldMap[normalized] = 1;
        fieldUniqueCounts[field] += 1;
        return;
    }

    fieldMap[normalized] += 1;
};

const updateStats = (
    parsed: ParsedLogLine | null,
    stats: LargeFileAggregateStats,
    fieldUniqueCounts: Record<string, number>
) => {
    if (!parsed) {
        return;
    }

    stats.parsedLines += 1;
    stats.formatCounts[parsed.formatId] = (stats.formatCounts[parsed.formatId] || 0) + 1;

    Object.entries(parsed.fields).forEach(([field, value]) => {
        addFieldValue(field, value, stats.fieldValueCounts, fieldUniqueCounts);
    });
};

const pushSampledLine = (
    sampledLines: HistogramLine[],
    line: HistogramLine,
    lineNumber: number
) => {
    if (sampledLines.length < MAX_HISTOGRAM_SAMPLE_LINES) {
        sampledLines.push(line);
        return;
    }

    const j = Math.floor(Math.random() * lineNumber);
    if (j < MAX_HISTOGRAM_SAMPLE_LINES) {
        sampledLines[j] = line;
    }
};

export const createSessionRecord = (payload: Omit<LogSessionRecord, 'sessionId' | 'createdAt' | 'lastOpenedAt' | 'isIndexed' | 'lineCount'>): LogSessionRecord => {
    return {
        sessionId: createLogSessionId(),
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        isIndexed: false,
        lineCount: 0,
        ...payload,
    };
};

export const indexLogFile = async (
    file: File,
    session: LogSessionRecord,
    options: IndexingOptions = {}
): Promise<IndexingResult> => {
    const { onProgress, signal } = options;
    const sessionId = session.sessionId;

    const decoder = new TextDecoder('utf-8');
    let offset = 0;
    let carry = '';
    let lineNumber = 1;
    let lastParsedLineNumber = 0;

    const linesBatch: LogLineRecord[] = [];
    const fieldBatch: LogFieldIndexRecord[] = [];
    const sampledLines: HistogramLine[] = [];

    const stats: LargeFileAggregateStats = {
        totalLines: 0,
        nonEmptyLines: 0,
        parsedLines: 0,
        formatCounts: {},
        fieldValueCounts: {},
    };

    const fieldUniqueCounts: Record<string, number> = {};

    const flushBatch = async () => {
        if (linesBatch.length === 0 && fieldBatch.length === 0) return;
        if (signal?.aborted || cancelledSessions.has(sessionId)) {
            throw new DOMException('Indexing aborted', 'AbortError');
        }
        const batchLines = linesBatch.splice(0, linesBatch.length);
        const batchFields = fieldBatch.splice(0, fieldBatch.length);
        await putLineBatch(batchLines, batchFields);
    };

    try {
        await upsertSession(session);

        if (signal?.aborted || cancelledSessions.has(sessionId)) {
            throw new DOMException('Indexing aborted', 'AbortError');
        }

        while (offset < file.size) {
            if (signal?.aborted || cancelledSessions.has(sessionId)) {
                throw new DOMException('Indexing aborted', 'AbortError');
            }

            const nextEnd = Math.min(file.size, offset + INDEX_CHUNK_BYTES);
            const buffer = await file.slice(offset, nextEnd).arrayBuffer();
            offset = nextEnd;

            const text = decoder.decode(buffer, { stream: offset < file.size });
            const combined = carry + text;
            const parts = combined.split(/\r?\n/);
            carry = parts.pop() ?? '';

            for (const raw of parts) {
                if (signal?.aborted || cancelledSessions.has(sessionId)) {
                    throw new DOMException('Indexing aborted', 'AbortError');
                }

                const trimmed = raw.trim();
                if (trimmed.length > 0) {
                    stats.nonEmptyLines += 1;
                }

                const parsed = trimmed.length > 0 ? parseLogLineAuto(raw) : null;
                if (parsed) {
                    lastParsedLineNumber = lineNumber;
                }

                updateStats(parsed, stats, fieldUniqueCounts);

                const isContinuation = !parsed && lastParsedLineNumber > 0 && isContinuationLine(raw);
                const groupId = isContinuation ? lastParsedLineNumber : lineNumber;
                const fields = parsed ? parsed.fields : {};
                const timestampMs = extractTimestampMs(parsed);

                linesBatch.push({
                    sessionId: session.sessionId,
                    lineNumber,
                    raw,
                    parsed: Boolean(parsed),
                    fields,
                    timestampMs,
                    groupId,
                    isContinuation,
                });

                if (parsed) {
                    Object.entries(fields).forEach(([field, value]) => {
                        const normalized = normalizeFieldValue(value);
                        if (!normalized) return;
                        fieldBatch.push({
                            sessionId: session.sessionId,
                            field,
                            value: normalized.toUpperCase(),
                            lineNumber,
                        });
                    });
                }

                pushSampledLine(sampledLines, { lineNumber, parsed, raw }, lineNumber);

                stats.totalLines += 1;
                lineNumber += 1;

                if (linesBatch.length >= BATCH_LINES) {
                    await flushBatch();
                }
            }

            onProgress?.({
                processedBytes: offset,
                totalBytes: file.size,
                linesIndexed: stats.totalLines,
            });
        }

        if (carry.length > 0) {
            if (signal?.aborted || cancelledSessions.has(sessionId)) {
                throw new DOMException('Indexing aborted', 'AbortError');
            }

            const trimmed = carry.trim();
            if (trimmed.length > 0) {
                stats.nonEmptyLines += 1;
            }

            const parsed = trimmed.length > 0 ? parseLogLineAuto(carry) : null;
            if (parsed) {
                lastParsedLineNumber = lineNumber;
            }

            updateStats(parsed, stats, fieldUniqueCounts);

            const isContinuation = !parsed && lastParsedLineNumber > 0 && isContinuationLine(carry);
            const groupId = isContinuation ? lastParsedLineNumber : lineNumber;
            const fields = parsed ? parsed.fields : {};
            const timestampMs = extractTimestampMs(parsed);

            linesBatch.push({
                sessionId: session.sessionId,
                lineNumber,
                raw: carry,
                parsed: Boolean(parsed),
                fields,
                timestampMs,
                groupId,
                isContinuation,
            });

            if (parsed) {
                Object.entries(fields).forEach(([field, value]) => {
                    const normalized = normalizeFieldValue(value);
                    if (!normalized) return;
                    fieldBatch.push({
                        sessionId: session.sessionId,
                        field,
                        value: normalized.toUpperCase(),
                        lineNumber,
                    });
                });
            }

            pushSampledLine(sampledLines, { lineNumber, parsed, raw: carry }, lineNumber);

            stats.totalLines += 1;
            lineNumber += 1;
        }

        await flushBatch();

        const sortedSampled = sampledLines.slice().sort((a, b) => a.lineNumber - b.lineNumber);

        if (signal?.aborted || cancelledSessions.has(sessionId)) {
            throw new DOMException('Indexing aborted', 'AbortError');
        }

        const updatedSession: LogSessionRecord = {
            ...session,
            isIndexed: true,
            lineCount: stats.totalLines,
            lastOpenedAt: Date.now(),
        };

        await upsertSession(updatedSession);
        await saveDashboardSnapshot(sessionId, {
            sessionId,
            kind: 'dashboard',
            stats,
            sampledLines: sortedSampled,
            updatedAt: Date.now(),
        });

        return {
            sessionId,
            lineCount: stats.totalLines,
            stats,
            sampledLines: sortedSampled,
        };
    } finally {
        cancelledSessions.delete(sessionId);
    }
};
