import { parseLogLineAuto, type ParsedLogLine } from './logFormatDetector';

export interface HistogramLine {
    lineNumber: number;
    parsed: ParsedLogLine | null;
    raw: string;
    error?: string;
}

const HISTOGRAM_SCAN_CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_HISTOGRAM_SAMPLE_LINES = 50_000;
const HISTOGRAM_YIELD_EVERY_CHUNKS = 8;
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

interface SamplingOptions {
    onProgress?: (progress: number) => void;
    isCancelled?: () => boolean;
}

interface SamplingInternalOptions extends SamplingOptions {
    includeStats?: boolean;
}

export interface LargeFileAggregateStats {
    totalLines: number;
    nonEmptyLines: number;
    parsedLines: number;
    formatCounts: Record<string, number>;
    fieldValueCounts: Record<string, Record<string, number>>;
}

export interface LargeFileSamplingResult {
    sampledLines: HistogramLine[];
    stats: LargeFileAggregateStats;
}

/**
 * Counts logical lines in a file using streaming chunk scan.
 */
export async function countFileLines(file: File): Promise<number> {
    if (file.size === 0) {
        return 0;
    }

    let offset = 0;
    let lineCount = 1;

    while (offset < file.size) {
        const buffer = await file.slice(offset, offset + HISTOGRAM_SCAN_CHUNK_BYTES).arrayBuffer();
        const bytes = new Uint8Array(buffer);

        for (let i = 0; i < bytes.length; i += 1) {
            if (bytes[i] === 10) {
                lineCount += 1;
            }
        }

        offset += bytes.length;
    }

    // Align with index-based behavior: trailing newline does not create an extra row.
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 1), file.size).arrayBuffer());
    if (tail.length === 1 && tail[0] === 10) {
        lineCount -= 1;
    }

    return Math.max(0, lineCount);
}

/**
 * Builds sampled parsed lines for histogram from full file content.
 */
export async function sampleLargeFileForHistogram(
    file: File,
    lineCount: number,
    options: SamplingOptions = {}
): Promise<HistogramLine[]> {
    const result = await scanLargeFile(file, lineCount, { ...options, includeStats: false });
    return result.sampledLines;
}

export async function sampleAndAnalyzeLargeFile(
    file: File,
    lineCount: number,
    options: SamplingOptions = {}
): Promise<LargeFileSamplingResult> {
    return scanLargeFile(file, lineCount, { ...options, includeStats: true });
}

async function scanLargeFile(
    file: File,
    lineCount: number,
    options: SamplingInternalOptions
): Promise<LargeFileSamplingResult> {
    if (lineCount <= 0) {
        return {
            sampledLines: [],
            stats: {
                totalLines: 0,
                nonEmptyLines: 0,
                parsedLines: 0,
                formatCounts: {},
                fieldValueCounts: {},
            },
        };
    }

    const { onProgress, isCancelled, includeStats } = options;
    const sampleStep = Math.max(1, Math.ceil(lineCount / MAX_HISTOGRAM_SAMPLE_LINES));
    const decoder = new TextDecoder('utf-8');
    const sampled: HistogramLine[] = [];
    const formatCounts: Record<string, number> = {};
    const fieldValueCounts: Record<string, Record<string, number>> = {};
    const fieldUniqueCounts: Record<string, number> = {};

    let nonEmptyLines = 0;
    let parsedLines = 0;

    let processedBytes = 0;
    let lineNumber = 1;
    let carry = '';
    let chunkCounter = 0;

    const canTrackField = (field: string): boolean => {
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

    const addFieldValue = (field: string, rawValue: string | undefined) => {
        const normalized = rawValue?.trim();
        if (!normalized || normalized === '-' || normalized === 'null' || normalized === 'undefined') {
            return;
        }

        if (!canTrackField(field)) {
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

    const aggregateParsed = (parsed: ParsedLogLine | null) => {
        if (!parsed) {
            return;
        }

        parsedLines += 1;
        formatCounts[parsed.formatId] = (formatCounts[parsed.formatId] || 0) + 1;

        Object.entries(parsed.fields).forEach(([field, value]) => {
            addFieldValue(field, value);
        });
    };

    while (processedBytes < file.size) {
        if (isCancelled?.()) {
            return {
                sampledLines: [],
                stats: {
                    totalLines: lineCount,
                    nonEmptyLines,
                    parsedLines,
                    formatCounts,
                    fieldValueCounts,
                },
            };
        }

        const nextEnd = Math.min(file.size, processedBytes + HISTOGRAM_SCAN_CHUNK_BYTES);
        const buffer = await file.slice(processedBytes, nextEnd).arrayBuffer();
        processedBytes = nextEnd;

        const text = decoder.decode(buffer, { stream: processedBytes < file.size });
        const combined = carry + text;
        const parts = combined.split(/\r?\n/);
        carry = parts.pop() ?? '';

        for (const raw of parts) {
            const shouldSample = (lineNumber - 1) % sampleStep === 0;
            const isNonEmpty = raw.trim().length > 0;

            let parsed = null;
            if (includeStats && isNonEmpty) {
                nonEmptyLines += 1;
                parsed = parseLogLineAuto(raw);
                aggregateParsed(parsed);
            }

            if (shouldSample) {
                if (!includeStats) {
                    parsed = parseLogLineAuto(raw);
                }
                sampled.push({
                    lineNumber,
                    parsed,
                    raw,
                });
            }
            lineNumber += 1;
        }

        chunkCounter += 1;
        if (chunkCounter >= HISTOGRAM_YIELD_EVERY_CHUNKS) {
            chunkCounter = 0;
            onProgress?.(Math.min(99, Math.round((processedBytes / Math.max(1, file.size)) * 100)));
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    if (!isCancelled?.() && carry.length > 0) {
        const shouldSample = (lineNumber - 1) % sampleStep === 0;
        const isNonEmpty = carry.trim().length > 0;
        let parsed = null;

        if (includeStats && isNonEmpty) {
            nonEmptyLines += 1;
            parsed = parseLogLineAuto(carry);
            aggregateParsed(parsed);
        }

        if (shouldSample) {
            if (!includeStats) {
                parsed = parseLogLineAuto(carry);
            }
            sampled.push({
                lineNumber,
                parsed,
                raw: carry,
            });
        }
    }

    onProgress?.(100);
    return {
        sampledLines: sampled,
        stats: {
            totalLines: lineCount,
            nonEmptyLines,
            parsedLines,
            formatCounts,
            fieldValueCounts,
        },
    };
}
