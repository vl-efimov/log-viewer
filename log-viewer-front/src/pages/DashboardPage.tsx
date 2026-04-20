import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import { RootState } from '../redux/store';
import NoFileSelected from '../components/common/NoFileSelected';
import { parseLogLineAuto, type ParsedLogLine } from '../utils/logFormatDetector';
import LogHistogram from '../components/LogHistogram';
import { extractTimestampFromParsedLine } from '../utils/logTimestamp';
import { getFileHandle, getFileObject } from '../redux/slices/logFileSlice';
import { getRemoteExactDashboardSnapshot } from '../services/bglAnomalyApi';
import { getDashboardSnapshot, getLocalExactDashboardSnapshot } from '../utils/logIndexedDb';
import {
    countFileLines,
    sampleAndAnalyzeLargeFile,
    type HistogramLine,
    type LargeFileAggregateStats,
} from '../utils/histogramSampling';

const MAX_CATEGORY_VALUES = 8;
const MAX_LARGE_FILE_CACHE_ENTRIES = 3;
const MAX_NORMAL_DASHBOARD_CACHE_ENTRIES = 5;
const PRIORITY_FIELDS = ['level', 'status', 'method', 'componentLevel', 'queue', 'type', 'component', 'host', 'user', 'class', 'ip'];
const CORE_CHART_FIELDS = ['level', 'status', 'method', 'componentLevel'];
const DASHBOARD_FIELD_ALIASES: Record<string, string> = {
    hostname: 'host',
    node: 'host',
    node2: 'host',
    logger: 'class',
    source: 'class',
    client: 'ip',
};

const toDashboardCanonicalField = (field: string): string => {
    const normalized = field.trim().toLowerCase();
    return DASHBOARD_FIELD_ALIASES[normalized] ?? field;
};

type LargeFileDashboardCacheEntry = {
    sampledLines: HistogramLine[];
    stats: LargeFileAggregateStats;
};

const largeFileDashboardCache = new Map<string, LargeFileDashboardCacheEntry>();
const normalDashboardCache = new Map<string, NormalDashboardSnapshot>();

const getLargeFileDashboardCacheKey = (
    analyticsSessionId: string,
    fileName: string,
    fileSize: number,
    lastModified: number
): string => {
    return `${analyticsSessionId}|${fileName}|${fileSize}|${lastModified}`;
};

const setLargeFileDashboardCache = (key: string, value: LargeFileDashboardCacheEntry) => {
    largeFileDashboardCache.delete(key);
    largeFileDashboardCache.set(key, value);

    while (largeFileDashboardCache.size > MAX_LARGE_FILE_CACHE_ENTRIES) {
        const oldestKey = largeFileDashboardCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        largeFileDashboardCache.delete(oldestKey);
    }
};

const setNormalDashboardCache = (key: string, value: NormalDashboardSnapshot) => {
    normalDashboardCache.delete(key);
    normalDashboardCache.set(key, value);

    while (normalDashboardCache.size > MAX_NORMAL_DASHBOARD_CACHE_ENTRIES) {
        const oldestKey = normalDashboardCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        normalDashboardCache.delete(oldestKey);
    }
};

type ParsedRow = {
    lineNumber: number;
    parsed: ParsedLogLine | null;
    raw: string;
};

type Facet = {
    field: string;
    values: Array<{ label: string; count: number }>;
};

type TimestampedDashboardRow = {
    row: ParsedRow;
    timestampMs: number;
    isParsed: boolean;
};

type HistogramCategoryFilter = {
    field: string | null;
    selectedCategories: string[] | null;
};

type NormalDashboardSnapshot = {
    totalLines: number;
    analyzedLines: number;
    nonEmptyLines: number;
    parsedLines: number;
    unparsedLines: number;
    parseRate: number;
    parsedRows: ParsedRow[];
    levelValues: Array<{ label: string; count: number }>;
    statusValues: Array<{ label: string; count: number }>;
    methodValues: Array<{ label: string; count: number }>;
    componentLevelValues: Array<{ label: string; count: number }>;
    facets: Facet[];
};

type DashboardStats = {
    totalLines: number;
    nonEmptyLines: number;
    parsedLines: number;
    fieldValueCounts: Record<string, Record<string, number>>;
};

type DashboardAnalyticsSummary = {
    analyzedLines: number;
    parsedLines: number;
    unparsedLines: number;
    parseRate: number;
    levelValues: Array<{ label: string; count: number }>;
    statusValues: Array<{ label: string; count: number }>;
    methodValues: Array<{ label: string; count: number }>;
    componentLevelValues: Array<{ label: string; count: number }>;
    facets: Facet[];
};

type ExactFilteredDashboardSnapshot = {
    totalLines: number;
    analytics: DashboardAnalyticsSummary;
};

const normalizeDashboardStats = (input: unknown): DashboardStats | null => {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const source = input as {
        totalLines?: unknown;
        nonEmptyLines?: unknown;
        parsedLines?: unknown;
        fieldValueCounts?: unknown;
    };

    const totalLines = Number(source.totalLines ?? 0);
    const nonEmptyLines = Number(source.nonEmptyLines ?? 0);
    const parsedLines = Number(source.parsedLines ?? 0);

    const rawFieldValueCounts = source.fieldValueCounts;
    const fieldValueCounts: Record<string, Record<string, number>> = {};

    if (rawFieldValueCounts && typeof rawFieldValueCounts === 'object') {
        Object.entries(rawFieldValueCounts as Record<string, unknown>).forEach(([field, values]) => {
            if (!values || typeof values !== 'object') {
                return;
            }

            const canonicalField = toDashboardCanonicalField(field);

            const normalizedValues: Record<string, number> = {};
            Object.entries(values as Record<string, unknown>).forEach(([label, count]) => {
                const numeric = Number(count ?? 0);
                if (!Number.isFinite(numeric) || numeric <= 0) {
                    return;
                }
                normalizedValues[label] = numeric;
            });

            if (Object.keys(normalizedValues).length > 0) {
                if (!fieldValueCounts[canonicalField]) {
                    fieldValueCounts[canonicalField] = {};
                }

                Object.entries(normalizedValues).forEach(([label, count]) => {
                    fieldValueCounts[canonicalField][label] = (fieldValueCounts[canonicalField][label] || 0) + count;
                });
            }
        });
    }

    return {
        totalLines: Number.isFinite(totalLines) ? Math.max(0, Math.round(totalLines)) : 0,
        nonEmptyLines: Number.isFinite(nonEmptyLines) ? Math.max(0, Math.round(nonEmptyLines)) : 0,
        parsedLines: Number.isFinite(parsedLines) ? Math.max(0, Math.round(parsedLines)) : 0,
        fieldValueCounts,
    };
};

const buildDashboardAnalyticsFromStats = (stats: DashboardStats, locale: string): DashboardAnalyticsSummary => {
    const fieldValueCounters = toFieldCounterMap(stats.fieldValueCounts);
    const analyzedLines = stats.totalLines;
    const parsedLines = Math.min(stats.parsedLines, analyzedLines);
    const unparsedLines = Math.max(analyzedLines - parsedLines, 0);

    return {
        analyzedLines,
        parsedLines,
        unparsedLines,
        parseRate: analyzedLines > 0 ? Math.round((parsedLines / analyzedLines) * 100) : 0,
        levelValues: toSortedCounterValues('level', fieldValueCounters.get('level'), locale),
        statusValues: toSortedCounterValues('status', fieldValueCounters.get('status'), locale),
        methodValues: toSortedCounterValues('method', fieldValueCounters.get('method'), locale),
        componentLevelValues: toSortedCounterValues('componentLevel', fieldValueCounters.get('componentLevel'), locale),
        facets: buildFacetValues(fieldValueCounters, locale),
    };
};

const normalizeDashboardSampledLines = (input: unknown): ParsedRow[] => {
    if (!Array.isArray(input)) {
        return [];
    }

    const normalizedRows = input
        .map((item): ParsedRow | null => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            const source = item as {
                lineNumber?: unknown;
                raw?: unknown;
                parsed?: {
                    formatId?: unknown;
                    fields?: unknown;
                    timestamp?: unknown;
                } | null;
                timestamp_iso?: unknown;
            };

            const lineNumber = typeof source.lineNumber === 'number' ? source.lineNumber : null;
            const raw = typeof source.raw === 'string' ? source.raw : '';
            if (!lineNumber || lineNumber <= 0) {
                return null;
            }

            const parsedFields = source.parsed?.fields && typeof source.parsed.fields === 'object'
                ? { ...(source.parsed.fields as Record<string, string>) }
                : {};

            let formatId = typeof source.parsed?.formatId === 'string'
                ? source.parsed.formatId
                : 'remote-dashboard';

            if (Object.keys(parsedFields).length === 0 && raw.trim().length > 0) {
                const reparsed = parseLogLineAuto(raw);
                if (reparsed) {
                    Object.assign(parsedFields, reparsed.fields);
                    formatId = reparsed.formatId;
                }
            }

            // Remote snapshots may contain date/time fields without a normalized
            // timestamp field; reparse to recover canonical timestamp for timeline filters.
            if (!parsedFields.timestamp && raw.trim().length > 0) {
                const reparsed = parseLogLineAuto(raw);
                if (reparsed?.fields.timestamp) {
                    parsedFields.timestamp = reparsed.fields.timestamp;
                    if (formatId === 'remote-dashboard') {
                        formatId = reparsed.formatId;
                    }
                }
            }

            if (!parsedFields.timestamp) {
                const nestedTimestamp = source.parsed?.timestamp;
                if (typeof nestedTimestamp === 'string' && nestedTimestamp.trim()) {
                    parsedFields.timestamp = nestedTimestamp;
                }
            }

            if (!parsedFields.timestamp && typeof source.timestamp_iso === 'string' && source.timestamp_iso.trim()) {
                parsedFields.timestamp = source.timestamp_iso;
            }

            return {
                lineNumber,
                raw,
                parsed: {
                    formatId,
                    fields: parsedFields,
                    raw,
                },
            };
        })
        .filter((row): row is ParsedRow => row !== null);

    const hasAnyTimestamp = normalizedRows.some((row) => Boolean(row.parsed?.fields.timestamp));
    if (hasAnyTimestamp) {
        return normalizedRows;
    }

    const syntheticBaseMs = Date.now();
    return normalizedRows.map((row, index) => {
        const parsed = row.parsed;
        if (!parsed) {
            return row;
        }

        return {
            ...row,
            parsed: {
                ...parsed,
                fields: {
                    ...parsed.fields,
                    // Fallback timeline for remote snapshots without timestamp parsing.
                    timestamp: new Date(syntheticBaseMs + index * 1000).toISOString(),
                },
            },
        };
    });
};

const resolveLocale = (language: string): string => {
    if (language === 'cz') return 'cs-CZ';
    if (language === 'ru') return 'ru-RU';
    return 'en-US';
};

const getFieldTitle = (field: string, t: (key: string, options?: Record<string, unknown>) => string): string => {
    const labels: Record<string, string> = {
        level: t('dashboard.charts.levels'),
        status: t('dashboard.charts.httpStatus'),
        method: t('dashboard.charts.httpMethods'),
        componentLevel: t('dashboard.dynamicFields.component'),
        queue: t('dashboard.dynamicFields.queue'),
        type: t('dashboard.dynamicFields.type'),
        component: t('dashboard.dynamicFields.component'),
        host: t('dashboard.dynamicFields.host'),
        user: t('dashboard.dynamicFields.user'),
        class: t('dashboard.dynamicFields.class'),
        ip: t('dashboard.dynamicFields.ip'),
    };

    return labels[field] || t('dashboard.dynamicFields.generic', { field });
};

const normalizeFieldValue = (value: string | undefined): string | null => {
    if (!value) return null;
    const normalized = value.trim();
    if (!normalized || normalized === '-' || normalized === 'null' || normalized === 'undefined') {
        return null;
    }
    return normalized;
};

const TIME_ONLY_FIELD_NAMES = new Set(['time']);
const DATE_ONLY_FIELD_NAMES = new Set(['date']);
const DATE_TIME_FIELD_NAMES = new Set(['timestamp', 'datetime', 'event_time', 'created_at']);

const EXCLUDED_DISTRIBUTION_FIELDS = new Set([
    'raw',
    'message',
    'msg',
    'content',
    'text',
    'log',
    'line',
    'time',
    'milliseconds',
    'millisecond',
    'msec',
    'ms',
    'timestamp',
    'datetime',
    'event_time',
    'created_at',
]);

const stripMillisecondsFromTime = (value: string): string => {
    return value
        // 15:37:24.622 -> 15:37:24
        .replace(/(\d{1,2}:\d{2}:\d{2})\.\d{1,6}/g, '$1')
        // 15:37:24,622 -> 15:37:24
        .replace(/(\d{1,2}:\d{2}:\d{2}),\d{1,6}/g, '$1');
};

const formatCompactDateToken = (value: string): string | null => {
    const digitsOnly = value.replace(/[^0-9]/g, '');
    if (/^\d{6}$/.test(digitsOnly)) {
        return `${digitsOnly.slice(0, 2)}.${digitsOnly.slice(2, 4)}.${digitsOnly.slice(4, 6)}`;
    }
    return null;
};

const toValidDate = (value: string): Date | null => {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }

    // Prevent accidental parsing of short numeric tokens (e.g. 81110 -> year 81110).
    if (/^\d+$/.test(normalized) && !/^\d{8}$/.test(normalized)) {
        return null;
    }

    // Support compact YYYYMMDD for date fields.
    if (/^\d{8}$/.test(normalized)) {
        const year = Number(normalized.slice(0, 4));
        const month = Number(normalized.slice(4, 6));
        const day = Number(normalized.slice(6, 8));
        if (year >= 1970 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const parsed = new Date(Date.UTC(year, month - 1, day));
            if (!Number.isNaN(parsed.getTime())) {
                return parsed;
            }
        }
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    const year = parsed.getUTCFullYear();
    if (year < 1970 || year > 2100) {
        return null;
    }

    return parsed;
};

const formatFieldLabelForDisplay = (field: string, value: string, locale: string): string => {
    const normalizedField = field.trim().toLowerCase();
    const normalizedValue = value.trim();

    if (TIME_ONLY_FIELD_NAMES.has(normalizedField)) {
        const timeWithoutMs = stripMillisecondsFromTime(normalizedValue);
        const digitsOnly = timeWithoutMs.replace(/[^0-9]/g, '');
        // Handle HHMMSS and HHMMSSmmm formats by taking the first 6 digits.
        if (digitsOnly.length >= 6) {
            const hhmmss = digitsOnly.slice(0, 6);
            return `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
        }

        // Already looks like HH:mm[:ss[.ms]]: keep as is.
        if (/^\d{1,2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalizedValue)) {
            return timeWithoutMs;
        }

        return normalizedValue;
    }

    if (DATE_ONLY_FIELD_NAMES.has(normalizedField)) {
        const compact = formatCompactDateToken(normalizedValue);
        if (compact) {
            return compact;
        }

        const parsed = toValidDate(normalizedValue);
        if (parsed) {
            return new Intl.DateTimeFormat(locale, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(parsed);
        }

        return normalizedValue;
    }

    if (DATE_TIME_FIELD_NAMES.has(normalizedField)) {
        const parsed = toValidDate(normalizedValue);
        if (parsed) {
            return new Intl.DateTimeFormat(locale, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            }).format(parsed);
        }

        return normalizedValue;
    }

    return normalizedValue;
};

const shortLabel = (value: string): string => {
    if (value.length <= 36) return value;
    return `${value.slice(0, 33)}...`;
};

const formatCompactNumber = (value: number, locale: string): string => {
    if (!Number.isFinite(value)) {
        return '0';
    }

    return new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value);
};

const toFieldCounterMap = (record: Record<string, Record<string, number>>): Map<string, Map<string, number>> => {
    const result = new Map<string, Map<string, number>>();

    Object.entries(record).forEach(([field, values]) => {
        const canonicalField = toDashboardCanonicalField(field);
        if (!result.has(canonicalField)) {
            result.set(canonicalField, new Map<string, number>());
        }

        const target = result.get(canonicalField)!;
        Object.entries(values).forEach(([label, count]) => {
            target.set(label, (target.get(label) || 0) + count);
        });
    });

    return result;
};

const toSortedCounterValues = (field: string, counter: Map<string, number> | undefined, locale: string) => {
    if (!counter) {
        return [];
    }

    return Array.from(counter.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CATEGORY_VALUES)
        .map(([label, count]) => ({
            label: shortLabel(formatFieldLabelForDisplay(field, label, locale)),
            count,
        }));
};

const buildFacetValues = (fieldValueCounters: Map<string, Map<string, number>>, locale: string): Facet[] => {
    const preferredFacetFields = PRIORITY_FIELDS.filter((field) => {
        const counter = fieldValueCounters.get(field);
        return Boolean(
            counter
            && counter.size > 1
            && !CORE_CHART_FIELDS.includes(field)
            && !EXCLUDED_DISTRIBUTION_FIELDS.has(field)
        );
    });

    const fallbackFacetFields = Array.from(fieldValueCounters.entries())
        .filter(([field, counter]) => {
            return counter.size > 1
                && !preferredFacetFields.includes(field)
                && !CORE_CHART_FIELDS.includes(field)
                && !EXCLUDED_DISTRIBUTION_FIELDS.has(field);
        })
        .sort(([, a], [, b]) => {
            const sumA = Array.from(a.values()).reduce((acc, curr) => acc + curr, 0);
            const sumB = Array.from(b.values()).reduce((acc, curr) => acc + curr, 0);
            if (sumA !== sumB) {
                return sumB - sumA;
            }
            return b.size - a.size;
        })
        .map(([field]) => field);

    const selectedFacetFields = [...preferredFacetFields, ...fallbackFacetFields].slice(0, 3);

    return selectedFacetFields.map((field) => {
        const values = fieldValueCounters.get(field);
        return {
            field,
            values: toSortedCounterValues(field, values, locale),
        };
    });
};

const buildDistributionsFromRows = (rows: ParsedRow[], locale: string): Pick<NormalDashboardSnapshot, 'levelValues' | 'statusValues' | 'methodValues' | 'componentLevelValues' | 'facets'> => {
    const fieldValueCounters = new Map<string, Map<string, number>>();

    rows.forEach((row) => {
        if (!row.parsed) {
            return;
        }

        Object.entries(row.parsed.fields).forEach(([field, value]) => {
            const canonicalField = toDashboardCanonicalField(field);
            if (EXCLUDED_DISTRIBUTION_FIELDS.has(canonicalField)) {
                return;
            }

            const normalized = normalizeFieldValue(value);
            if (!normalized) {
                return;
            }

            if (!fieldValueCounters.has(canonicalField)) {
                fieldValueCounters.set(canonicalField, new Map<string, number>());
            }
            const counter = fieldValueCounters.get(canonicalField);
            if (!counter) {
                return;
            }
            counter.set(normalized, (counter.get(normalized) || 0) + 1);
        });
    });

    return {
        levelValues: toSortedCounterValues('level', fieldValueCounters.get('level'), locale),
        statusValues: toSortedCounterValues('status', fieldValueCounters.get('status'), locale),
        methodValues: toSortedCounterValues('method', fieldValueCounters.get('method'), locale),
        componentLevelValues: toSortedCounterValues('componentLevel', fieldValueCounters.get('componentLevel'), locale),
        facets: buildFacetValues(fieldValueCounters, locale),
    };
};

const createStableSyntheticBaseMs = (seed: string): number => {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = ((hash * 31) + seed.charCodeAt(i)) >>> 0;
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const anchorMs = Date.UTC(2020, 0, 1);
    return anchorMs + ((hash % 365) * dayMs);
};

const ensureTimelineTimestamps = (rows: ParsedRow[], seed: string): ParsedRow[] => {
    const hasRealTimestamps = rows.some((row) => row.parsed && extractTimestampFromParsedLine(row.parsed) !== null);
    if (hasRealTimestamps) {
        return rows;
    }

    const parsedCount = rows.reduce((acc, row) => acc + (row.parsed ? 1 : 0), 0);
    if (parsedCount === 0) {
        return rows;
    }

    const syntheticBaseMs = createStableSyntheticBaseMs(seed);
    let parsedIndex = 0;

    return rows.map((row) => {
        if (!row.parsed) {
            return row;
        }

        const existingTimestamp = row.parsed.fields.timestamp;
        if (existingTimestamp && existingTimestamp.trim()) {
            parsedIndex += 1;
            return row;
        }

        const timestamp = new Date(syntheticBaseMs + (parsedIndex * 1000)).toISOString();
        parsedIndex += 1;

        return {
            ...row,
            parsed: {
                ...row.parsed,
                fields: {
                    ...row.parsed.fields,
                    timestamp,
                },
            },
        };
    });
};

const buildTimestampedRowsForWindow = (rows: ParsedRow[], seed: string): TimestampedDashboardRow[] => {
    if (rows.length === 0) {
        return [];
    }

    const explicitTimestamps = rows
        .map((row, index) => {
            if (!row.parsed) {
                return null;
            }

            const ts = extractTimestampFromParsedLine(row.parsed);
            if (ts === null) {
                return null;
            }

            return { index, lineNumber: row.lineNumber, ts };
        })
        .filter((item): item is { index: number; lineNumber: number; ts: number } => item !== null)
        .sort((a, b) => a.lineNumber - b.lineNumber);

    if (explicitTimestamps.length === 0) {
        const syntheticBaseMs = createStableSyntheticBaseMs(seed);
        return rows.map((row, index) => ({
            row,
            timestampMs: syntheticBaseMs + (index * 1000),
            isParsed: Boolean(row.parsed),
        }));
    }

    const lowerBound = (lineNumber: number): number => {
        let left = 0;
        let right = explicitTimestamps.length;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (explicitTimestamps[mid].lineNumber < lineNumber) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        return left;
    };

    return rows.map((row) => {
        const parsedTimestamp = row.parsed ? extractTimestampFromParsedLine(row.parsed) : null;
        if (parsedTimestamp !== null) {
            return {
                row,
                timestampMs: parsedTimestamp,
                isParsed: true,
            };
        }

        const rightIdx = lowerBound(row.lineNumber);
        const left = rightIdx > 0 ? explicitTimestamps[rightIdx - 1] : null;
        const right = rightIdx < explicitTimestamps.length ? explicitTimestamps[rightIdx] : null;

        let estimatedTs: number;
        if (left && right && right.lineNumber !== left.lineNumber) {
            const ratio = (row.lineNumber - left.lineNumber) / (right.lineNumber - left.lineNumber);
            estimatedTs = left.ts + ((right.ts - left.ts) * ratio);
        } else if (left) {
            estimatedTs = left.ts + ((row.lineNumber - left.lineNumber) * 1000);
        } else if (right) {
            estimatedTs = right.ts - ((right.lineNumber - row.lineNumber) * 1000);
        } else {
            const syntheticBaseMs = createStableSyntheticBaseMs(seed);
            estimatedTs = syntheticBaseMs;
        }

        return {
            row,
            timestampMs: estimatedTs,
            isParsed: Boolean(row.parsed),
        };
    });
};

const toChartOption = (
    title: string,
    values: Array<{ label: string; count: number }>,
    locale: string
) => {
    return {
        animation: false,
        title: {
            text: title,
            left: 'left',
            textStyle: {
                fontSize: 13,
                fontWeight: 600,
            },
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            valueFormatter: (value: number | string) => {
                if (typeof value === 'number') {
                    return value.toLocaleString(locale);
                }
                return String(value);
            },
        },
        grid: {
            top: 34,
            right: 24,
            left: 10,
            bottom: 10,
            containLabel: true,
        },
        xAxis: {
            type: 'value',
            minInterval: 1,
            splitNumber: 4,
            axisLabel: {
                hideOverlap: true,
                formatter: (value: number) => formatCompactNumber(value, locale),
            },
        },
        yAxis: {
            type: 'category',
            data: values.map((item) => item.label),
            inverse: true,
            axisLabel: {
                width: 150,
                overflow: 'truncate',
            },
        },
        series: [
            {
                type: 'bar',
                data: values.map((item) => item.count),
                label: {
                    show: true,
                    position: 'right',
                    distance: 4,
                    formatter: (params: { value: number }) => formatCompactNumber(params.value, locale),
                },
                labelLayout: {
                    hideOverlap: true,
                },
                itemStyle: {
                    borderRadius: [0, 6, 6, 0],
                },
            },
        ],
    };
};

const DashboardPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const locale = useMemo(() => resolveLocale(i18n.language), [i18n.language]);
    const {
        isMonitoring,
        content,
        name: fileName,
        isLargeFile,
        analyticsSessionId,
        size: fileSize,
        lastModified,
        loaded,
        isIndexing,
    } = useSelector((state: RootState) => state.logFile);
    const [isHistogramLoading, setIsHistogramLoading] = useState<boolean>(false);
    const [histogramProgress, setHistogramProgress] = useState<number>(0);
    const [largeFileHistogramLines, setLargeFileHistogramLines] = useState<HistogramLine[]>([]);
    const [largeFileStats, setLargeFileStats] = useState<LargeFileAggregateStats | null>(null);
    const [normalSnapshot, setNormalSnapshot] = useState<NormalDashboardSnapshot | null>(null);
    const [isNormalSnapshotLoading, setIsNormalSnapshotLoading] = useState<boolean>(false);
    const [exactFilteredSnapshot, setExactFilteredSnapshot] = useState<ExactFilteredDashboardSnapshot | null>(null);
    const [isExactFilteredLoading, setIsExactFilteredLoading] = useState<boolean>(false);
    const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: number | null; end: number | null }>({
        start: null,
        end: null,
    });
    const [histogramCategoryFilter, setHistogramCategoryFilter] = useState<HistogramCategoryFilter>({
        field: null,
        selectedCategories: null,
    });
    const isRemoteLargeSession = isLargeFile && analyticsSessionId.startsWith('remote:');
    const remoteIngestId = useMemo(() => {
        if (!isRemoteLargeSession) {
            return null;
        }
        return analyticsSessionId.slice('remote:'.length);
    }, [analyticsSessionId, isRemoteLargeSession]);
    const requiresServerUploadForDashboard = isLargeFile && !isRemoteLargeSession;
    const useLocalLargeMode = false;
    const largeFileCacheKey = useMemo(() => {
        return getLargeFileDashboardCacheKey(analyticsSessionId, fileName, fileSize, lastModified);
    }, [analyticsSessionId, fileName, fileSize, lastModified]);
    const normalFileCacheKey = useMemo(() => {
        return `${analyticsSessionId}|${fileName}|${fileSize}|${lastModified}`;
    }, [analyticsSessionId, fileName, fileSize, lastModified]);

    const hasActiveTimeRange = (
        selectedTimeRange.start !== null
        && selectedTimeRange.end !== null
        && Number.isFinite(selectedTimeRange.start)
        && Number.isFinite(selectedTimeRange.end)
    );

    useEffect(() => {
        setSelectedTimeRange({ start: null, end: null });
        setHistogramCategoryFilter({ field: null, selectedCategories: null });
        setExactFilteredSnapshot(null);
        setIsExactFilteredLoading(false);
    }, [normalFileCacheKey]);

    useEffect(() => {
        return () => {
            largeFileDashboardCache.clear();
            normalDashboardCache.clear();
        };
    }, []);

    const analytics = useMemo(() => {
        if (requiresServerUploadForDashboard) {
            return {
                totalLines: 0,
                analyzedLines: 0,
                nonEmptyLines: 0,
                parsedLines: 0,
                unparsedLines: 0,
                parseRate: 0,
                parsedRows: [] as HistogramLine[],
                levelValues: [] as Array<{ label: string; count: number }>,
                statusValues: [] as Array<{ label: string; count: number }>,
                methodValues: [] as Array<{ label: string; count: number }>,
                componentLevelValues: [] as Array<{ label: string; count: number }>,
                facets: [] as Facet[],
            };
        }

        if (useLocalLargeMode && !largeFileStats) {
            return {
                totalLines: 0,
                analyzedLines: 0,
                nonEmptyLines: 0,
                parsedLines: 0,
                unparsedLines: 0,
                parseRate: 0,
                parsedRows: [] as HistogramLine[],
                levelValues: [] as Array<{ label: string; count: number }>,
                statusValues: [] as Array<{ label: string; count: number }>,
                methodValues: [] as Array<{ label: string; count: number }>,
                componentLevelValues: [] as Array<{ label: string; count: number }>,
                facets: [] as Facet[],
            };
        }

        if (useLocalLargeMode && largeFileStats) {
            const fieldValueCounters = toFieldCounterMap(largeFileStats.fieldValueCounts);

            return {
                totalLines: largeFileStats.totalLines,
                analyzedLines: largeFileStats.totalLines,
                nonEmptyLines: largeFileStats.nonEmptyLines,
                parsedLines: largeFileStats.parsedLines,
                unparsedLines: Math.max(largeFileStats.nonEmptyLines - largeFileStats.parsedLines, 0),
                parseRate: largeFileStats.nonEmptyLines > 0
                    ? Math.round((largeFileStats.parsedLines / largeFileStats.nonEmptyLines) * 100)
                    : 0,
                parsedRows: largeFileHistogramLines,
                levelValues: toSortedCounterValues('level', fieldValueCounters.get('level'), locale),
                statusValues: toSortedCounterValues('status', fieldValueCounters.get('status'), locale),
                methodValues: toSortedCounterValues('method', fieldValueCounters.get('method'), locale),
                componentLevelValues: toSortedCounterValues('componentLevel', fieldValueCounters.get('componentLevel'), locale),
                facets: buildFacetValues(fieldValueCounters, locale),
            };
        }

        if (normalSnapshot) {
            return normalSnapshot;
        }

        const cached = normalDashboardCache.get(normalFileCacheKey);
        if (cached) {
            return cached;
        }

        const lines = (content ?? '').split(/\r?\n/);
        const parsedRows: ParsedRow[] = [];
        const fieldValueCounters = new Map<string, Map<string, number>>();

        let nonEmptyLines = 0;
        let parsedLines = 0;

        for (let i = 0; i < lines.length; i += 1) {
            const raw = lines[i];
            if (raw.trim().length === 0) continue;

            nonEmptyLines += 1;
            const parsed = parseLogLineAuto(raw);
            parsedRows.push({ lineNumber: i + 1, parsed, raw });

            if (!parsed) {
                continue;
            }

            parsedLines += 1;

            Object.entries(parsed.fields).forEach(([field, value]) => {
                const canonicalField = toDashboardCanonicalField(field);
                const normalized = normalizeFieldValue(value);
                if (!normalized) {
                    return;
                }

                if (!fieldValueCounters.has(canonicalField)) {
                    fieldValueCounters.set(canonicalField, new Map<string, number>());
                }
                const fieldCounter = fieldValueCounters.get(canonicalField)!;
                fieldCounter.set(normalized, (fieldCounter.get(normalized) || 0) + 1);
            });
        }

        const snapshot: NormalDashboardSnapshot = {
            totalLines: lines.length,
            analyzedLines: lines.length,
            nonEmptyLines,
            parsedLines,
            unparsedLines: Math.max(nonEmptyLines - parsedLines, 0),
            parseRate: nonEmptyLines > 0 ? Math.round((parsedLines / nonEmptyLines) * 100) : 0,
            parsedRows,
            levelValues: toSortedCounterValues('level', fieldValueCounters.get('level'), locale),
            statusValues: toSortedCounterValues('status', fieldValueCounters.get('status'), locale),
            methodValues: toSortedCounterValues('method', fieldValueCounters.get('method'), locale),
            componentLevelValues: toSortedCounterValues('componentLevel', fieldValueCounters.get('componentLevel'), locale),
            facets: buildFacetValues(fieldValueCounters, locale),
        };
        setNormalDashboardCache(normalFileCacheKey, snapshot);
        return snapshot;
    }, [
        content,
        largeFileHistogramLines,
        largeFileStats,
        normalFileCacheKey,
        normalSnapshot,
        locale,
        requiresServerUploadForDashboard,
        useLocalLargeMode,
    ]);

    useEffect(() => {
        if (requiresServerUploadForDashboard || useLocalLargeMode || !analyticsSessionId) {
            setNormalSnapshot(null);
            setIsNormalSnapshotLoading(false);
            return;
        }

        if (isIndexing) {
            setIsNormalSnapshotLoading(true);
            return;
        }

        let cancelled = false;

        const loadSnapshot = async () => {
            setIsNormalSnapshotLoading(true);
            try {
                const snapshot = await getDashboardSnapshot(analyticsSessionId);
                if (cancelled) return;
                if (snapshot) {
                    const stats = normalizeDashboardStats(snapshot.stats);
                    if (!stats) {
                        setNormalSnapshot(null);
                        return;
                    }

                    const summary = buildDashboardAnalyticsFromStats(stats, locale);
                    const snapshotData: NormalDashboardSnapshot = {
                        totalLines: stats.totalLines,
                        analyzedLines: summary.analyzedLines,
                        nonEmptyLines: stats.nonEmptyLines,
                        parsedLines: summary.parsedLines,
                        unparsedLines: summary.unparsedLines,
                        parseRate: summary.parseRate,
                        parsedRows: normalizeDashboardSampledLines(snapshot.sampledLines),
                        levelValues: summary.levelValues,
                        statusValues: summary.statusValues,
                        methodValues: summary.methodValues,
                        componentLevelValues: summary.componentLevelValues,
                        facets: summary.facets,
                    };

                    setNormalSnapshot(snapshotData);
                } else {
                    setNormalSnapshot(null);
                }
            } finally {
                if (!cancelled) {
                    setIsNormalSnapshotLoading(false);
                }
            }
        };

        void loadSnapshot();

        return () => {
            cancelled = true;
        };
    }, [analyticsSessionId, isIndexing, locale, requiresServerUploadForDashboard, useLocalLargeMode]);

    useEffect(() => {
        if (!isMonitoring || !useLocalLargeMode) {
            setIsHistogramLoading(false);
            setHistogramProgress(0);
            setLargeFileHistogramLines([]);
            setLargeFileStats(null);
            return;
        }

        const cached = largeFileDashboardCache.get(largeFileCacheKey);
        if (cached) {
            setLargeFileHistogramLines(cached.sampledLines);
            setLargeFileStats(cached.stats);
            setIsHistogramLoading(false);
            setHistogramProgress(0);
            return;
        }

        let cancelled = false;

        const buildLargeFileHistogram = async () => {
            const handle = getFileHandle();
            const file = handle ? await handle.getFile() : getFileObject();
            if (!file || cancelled) return;

            setIsHistogramLoading(true);
            setHistogramProgress(0);

            const totalLines = await countFileLines(file);
            if (cancelled) return;

            const result = await sampleAndAnalyzeLargeFile(file, totalLines, {
                onProgress: (progress) => setHistogramProgress(progress),
                isCancelled: () => cancelled,
            });

            if (cancelled) return;

            setLargeFileHistogramLines(result.sampledLines);
            setLargeFileStats(result.stats);
            setLargeFileDashboardCache(largeFileCacheKey, {
                sampledLines: result.sampledLines,
                stats: result.stats,
            });
            setIsHistogramLoading(false);
        };

        void buildLargeFileHistogram();

        return () => {
            cancelled = true;
        };
    }, [isMonitoring, largeFileCacheKey, useLocalLargeMode]);

    const histogramSourceLines = useMemo(() => {
        const sourceRows = useLocalLargeMode ? largeFileHistogramLines : analytics.parsedRows;
        return ensureTimelineTimestamps(sourceRows, normalFileCacheKey);
    }, [analytics.parsedRows, largeFileHistogramLines, normalFileCacheKey, useLocalLargeMode]);

    const timestampedRowsAll = useMemo(() => {
        return buildTimestampedRowsForWindow(histogramSourceLines, normalFileCacheKey);
    }, [histogramSourceLines, normalFileCacheKey]);

    const timelineBounds = useMemo(() => {
        if (timestampedRowsAll.length === 0) {
            return null;
        }

        let min = timestampedRowsAll[0].timestampMs;
        let max = timestampedRowsAll[0].timestampMs;

        for (let i = 1; i < timestampedRowsAll.length; i += 1) {
            const ts = timestampedRowsAll[i].timestampMs;
            if (ts < min) {
                min = ts;
            }
            if (ts > max) {
                max = ts;
            }
        }

        return { min, max };
    }, [timestampedRowsAll]);

    const applyTimeRangeSelection = useCallback((startTime: number | null, endTime: number | null) => {
        if (
            startTime === null
            || endTime === null
            || !Number.isFinite(startTime)
            || !Number.isFinite(endTime)
            || !timelineBounds
        ) {
            setSelectedTimeRange({ start: null, end: null });
            return;
        }

        const requestedStart = Math.min(startTime, endTime);
        const requestedEnd = Math.max(startTime, endTime);

        // Preserve fully out-of-bounds ranges to allow true empty-window filters.
        if (requestedEnd < timelineBounds.min || requestedStart > timelineBounds.max) {
            setSelectedTimeRange({
                start: Math.floor(requestedStart),
                end: Math.ceil(requestedEnd),
            });
            return;
        }

        let start = Math.max(timelineBounds.min, Math.floor(requestedStart));
        let end = Math.min(timelineBounds.max, Math.ceil(requestedEnd));

        const totalWindow = Math.max(1, timelineBounds.max - timelineBounds.min);
        const minWindowMs = Math.max(1000, Math.min(60_000, Math.floor(totalWindow / 250)));

        if (end <= start) {
            const center = Math.max(timelineBounds.min, Math.min(timelineBounds.max, start));
            const half = Math.floor(minWindowMs / 2);
            start = Math.max(timelineBounds.min, center - half);
            end = Math.min(timelineBounds.max, start + minWindowMs);

            if (end <= start) {
                setSelectedTimeRange({ start: null, end: null });
                return;
            }
        }

        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            setSelectedTimeRange({ start: null, end: null });
            return;
        }

        setSelectedTimeRange({ start, end });
    }, [timelineBounds]);

    const windowRows = useMemo(() => {
        const timestampedRows = timestampedRowsAll;

        if (!hasActiveTimeRange) {
            return timestampedRows;
        }

        const rangeStart = selectedTimeRange.start;
        const rangeEnd = selectedTimeRange.end;
        if (rangeStart === null || rangeEnd === null) {
            return timestampedRows;
        }

        return timestampedRows.filter((item) => item.timestampMs >= rangeStart && item.timestampMs <= rangeEnd);
    }, [hasActiveTimeRange, selectedTimeRange.end, selectedTimeRange.start, timestampedRowsAll]);

    const selectedCategoriesSet = useMemo(() => {
        if (!histogramCategoryFilter.selectedCategories || histogramCategoryFilter.selectedCategories.length === 0) {
            return null;
        }

        return new Set(histogramCategoryFilter.selectedCategories.map((value) => value.trim().toUpperCase()));
    }, [histogramCategoryFilter.selectedCategories]);

    const hasActiveCategoryFilter = selectedCategoriesSet !== null;

    const categoryFilteredRows = useMemo(() => {
        if (!selectedCategoriesSet) {
            return windowRows;
        }

        const categoryField = histogramCategoryFilter.field;

        return windowRows.filter((item) => {
            if (!item.row.parsed) {
                return false;
            }

            const rawCategory = categoryField
                ? item.row.parsed.fields[categoryField]
                : 'UNKNOWN';
            const normalized = rawCategory && rawCategory.trim().length > 0
                ? rawCategory.trim().toUpperCase()
                : 'UNKNOWN';

            return selectedCategoriesSet.has(normalized);
        });
    }, [histogramCategoryFilter.field, selectedCategoriesSet, windowRows]);

    const shouldUseExactFiltered = hasActiveTimeRange || hasActiveCategoryFilter;
    const shouldUseRemoteExact = isRemoteLargeSession && shouldUseExactFiltered;
    const shouldUseLocalExact = !isRemoteLargeSession && shouldUseExactFiltered && Boolean(analyticsSessionId);
    const shouldUseExactFilteredSnapshot = shouldUseRemoteExact || shouldUseLocalExact;

    useEffect(() => {
        if (!shouldUseExactFilteredSnapshot) {
            setExactFilteredSnapshot(null);
            setIsExactFilteredLoading(false);
            return;
        }

        const abortController = new AbortController();
        let cancelled = false;
        setIsExactFilteredLoading(true);

        const timer = window.setTimeout(() => {
            const loadExactFilteredSnapshot = async () => {
                try {
                    const snapshot = shouldUseRemoteExact
                        ? await getRemoteExactDashboardSnapshot(
                            remoteIngestId!,
                            {
                                startMs: hasActiveTimeRange ? selectedTimeRange.start : null,
                                endMs: hasActiveTimeRange ? selectedTimeRange.end : null,
                                categoryField: hasActiveCategoryFilter ? histogramCategoryFilter.field : null,
                                categoryValues: hasActiveCategoryFilter ? histogramCategoryFilter.selectedCategories : null,
                            },
                            { signal: abortController.signal },
                        )
                        : await getLocalExactDashboardSnapshot(
                            analyticsSessionId,
                            {
                                startMs: hasActiveTimeRange ? selectedTimeRange.start : null,
                                endMs: hasActiveTimeRange ? selectedTimeRange.end : null,
                                categoryField: hasActiveCategoryFilter ? histogramCategoryFilter.field : null,
                                categoryValues: hasActiveCategoryFilter ? histogramCategoryFilter.selectedCategories : null,
                                signal: abortController.signal,
                            },
                        );

                    if (cancelled) {
                        return;
                    }

                    const snapshotStats = normalizeDashboardStats(
                        (snapshot as { stats?: unknown } | null)?.stats,
                    );
                    if (!snapshotStats) {
                        setExactFilteredSnapshot(null);
                        return;
                    }

                    setExactFilteredSnapshot({
                        totalLines: snapshotStats.totalLines,
                        analytics: buildDashboardAnalyticsFromStats(snapshotStats, locale),
                    });
                } catch {
                    if (abortController.signal.aborted || cancelled) {
                        return;
                    }
                    setExactFilteredSnapshot(null);
                } finally {
                    if (!cancelled) {
                        setIsExactFilteredLoading(false);
                    }
                }
            };

            void loadExactFilteredSnapshot();
        }, 250);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            abortController.abort();
        };
    }, [
        hasActiveCategoryFilter,
        hasActiveTimeRange,
        histogramCategoryFilter.field,
        histogramCategoryFilter.selectedCategories,
        locale,
        analyticsSessionId,
        remoteIngestId,
        selectedTimeRange.end,
        selectedTimeRange.start,
        shouldUseExactFilteredSnapshot,
        shouldUseLocalExact,
        shouldUseRemoteExact,
    ]);

    const chartAnalytics = useMemo(() => {
        const buildApproximateFromWindow = () => {
            const filteredParsedRows = categoryFilteredRows
                .filter((item) => item.isParsed)
                .map((item) => item.row);

            const distributions = buildDistributionsFromRows(filteredParsedRows, locale);
            const analyzedLines = categoryFilteredRows.length;
            const parsedLines = filteredParsedRows.length;
            const unparsedLines = Math.max(analyzedLines - parsedLines, 0);
            const parseRate = analyzedLines > 0
                ? Math.round((parsedLines / analyzedLines) * 100)
                : 0;

            return {
                analyzedLines,
                parsedLines,
                unparsedLines,
                parseRate,
                levelValues: distributions.levelValues,
                statusValues: distributions.statusValues,
                methodValues: distributions.methodValues,
                componentLevelValues: distributions.componentLevelValues,
                facets: distributions.facets,
            };
        };

        if (!hasActiveTimeRange && !hasActiveCategoryFilter) {
            return {
                analyzedLines: analytics.analyzedLines,
                parsedLines: analytics.parsedLines,
                unparsedLines: analytics.unparsedLines,
                parseRate: analytics.parseRate,
                levelValues: analytics.levelValues,
                statusValues: analytics.statusValues,
                methodValues: analytics.methodValues,
                componentLevelValues: analytics.componentLevelValues,
                facets: analytics.facets,
            };
        }

        if (shouldUseExactFilteredSnapshot) {
            if (!exactFilteredSnapshot) {
                return {
                    analyzedLines: analytics.analyzedLines,
                    parsedLines: analytics.parsedLines,
                    unparsedLines: analytics.unparsedLines,
                    parseRate: analytics.parseRate,
                    levelValues: analytics.levelValues,
                    statusValues: analytics.statusValues,
                    methodValues: analytics.methodValues,
                    componentLevelValues: analytics.componentLevelValues,
                    facets: analytics.facets,
                };
            }

            return exactFilteredSnapshot.analytics;
        }

        return buildApproximateFromWindow();
    }, [
        analytics.analyzedLines,
        analytics.componentLevelValues,
        analytics.facets,
        analytics.levelValues,
        analytics.methodValues,
        analytics.parsedLines,
        analytics.parseRate,
        analytics.statusValues,
        analytics.unparsedLines,
        categoryFilteredRows,
        exactFilteredSnapshot,
        hasActiveCategoryFilter,
        hasActiveTimeRange,
        locale,
        shouldUseExactFilteredSnapshot,
    ]);

    const kpiAnalytics = useMemo(() => {
        if (!hasActiveTimeRange && !hasActiveCategoryFilter) {
            return {
                totalLines: analytics.totalLines,
                parsedLines: analytics.parsedLines,
                unparsedLines: analytics.unparsedLines,
                parseRate: analytics.parseRate,
            };
        }

        if (shouldUseExactFilteredSnapshot) {
            if (!exactFilteredSnapshot) {
                return {
                    totalLines: analytics.totalLines,
                    parsedLines: analytics.parsedLines,
                    unparsedLines: analytics.unparsedLines,
                    parseRate: analytics.parseRate,
                };
            }

            return {
                totalLines: exactFilteredSnapshot.totalLines,
                parsedLines: exactFilteredSnapshot.analytics.parsedLines,
                unparsedLines: exactFilteredSnapshot.analytics.unparsedLines,
                parseRate: exactFilteredSnapshot.analytics.parseRate,
            };
        }

        return {
            totalLines: chartAnalytics.analyzedLines,
            parsedLines: chartAnalytics.parsedLines,
            unparsedLines: chartAnalytics.unparsedLines,
            parseRate: chartAnalytics.parseRate,
        };
    }, [
        analytics.parseRate,
        analytics.parsedLines,
        analytics.totalLines,
        analytics.unparsedLines,
        chartAnalytics.analyzedLines,
        chartAnalytics.parseRate,
        chartAnalytics.parsedLines,
        chartAnalytics.unparsedLines,
        exactFilteredSnapshot,
        hasActiveCategoryFilter,
        hasActiveTimeRange,
        shouldUseExactFilteredSnapshot,
    ]);

    const isLargeScanPending = useLocalLargeMode && !largeFileStats;
    const hasLevelChartData = chartAnalytics.levelValues.length > 0;
    const hasStatusChartData = chartAnalytics.statusValues.length > 0;
    const hasMethodChartData = chartAnalytics.methodValues.length > 0;
    const hasComponentLevelChartData = chartAnalytics.componentLevelValues.length > 0;
    const hasAnyTopChartData = hasLevelChartData || hasStatusChartData || hasMethodChartData || hasComponentLevelChartData;
    const topChartGridMd = hasComponentLevelChartData ? 3 : 4;
    const shouldShowBottomNoDataMessage = (
        (hasActiveTimeRange || hasActiveCategoryFilter)
        && chartAnalytics.analyzedLines === 0
    );
    const isExactRebuildInProgress = isExactFilteredLoading && shouldUseExactFilteredSnapshot;

    if (!isMonitoring && !loaded) {
        return (
            <NoFileSelected
                title={t('dashboard.title')}
                description={t('dashboard.selectFileDescription')}
            />
        );
    }

    if (requiresServerUploadForDashboard) {
        return (
            <Box>
                <Stack spacing={2}>
                    <Typography variant="h5">
                        {t('dashboard.title')}
                    </Typography>
                    <Alert severity="info">
                        Для больших файлов дашборд строится только после загрузки файла на сервер. Перейдите на страницу просмотра логов и нажмите "Загрузить на сервер".
                    </Alert>
                </Stack>
            </Box>
        );
    }

    if (!content && !useLocalLargeMode && !normalSnapshot && !isNormalSnapshotLoading) {
        return (
            <NoFileSelected
                title={t('dashboard.title')}
                description={t('dashboard.noDataDescription')}
                showButton={false}
            />
        );
    }

    return (
        <Box>
            <Stack spacing={2}>
                <Box>
                    <Typography variant="h5">
                        {t('dashboard.title')}
                    </Typography>
                </Box>

                {useLocalLargeMode && (
                    <Alert severity="info">
                        {t('dashboard.largeFileFullScanNotice')}
                    </Alert>
                )}

                {isLargeScanPending && (
                    <Card>
                        <CardContent>
                            <Box
                                sx={{
                                    minHeight: 160,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 2,
                                }}
                            >
                                <CircularProgress size={24} />
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                >
                                    {t('dashboard.histogramBuilding', { progress: histogramProgress })}
                                </Typography>
                            </Box>
                        </CardContent>
                    </Card>
                )}

                {!isLargeScanPending && (
                    <Box sx={{ position: 'relative' }}>
                        <Grid
                            container
                            spacing={2}
                        >
                            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                <Card>
                                    <CardContent>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                        >{t('dashboard.metrics.totalLines')}
                                        </Typography>
                                        <Typography variant="h4">{kpiAnalytics.totalLines.toLocaleString(locale)}</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                <Card>
                                    <CardContent>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                        >{t('dashboard.metrics.parsedLines')}
                                        </Typography>
                                        <Typography variant="h4">{kpiAnalytics.parsedLines.toLocaleString(locale)}</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                <Card>
                                    <CardContent>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                        >{t('dashboard.metrics.unparsedLines')}
                                        </Typography>
                                        <Typography variant="h4">{kpiAnalytics.unparsedLines.toLocaleString(locale)}</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                <Card>
                                    <CardContent>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                        >{t('dashboard.metrics.parseRate')}
                                        </Typography>
                                        <Typography variant="h4">{kpiAnalytics.parseRate}%</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                        </Grid>

                        {isExactRebuildInProgress && (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    inset: 0,
                                    backgroundColor: 'rgba(255, 255, 255, 0.45)',
                                    backdropFilter: 'blur(1px)',
                                    borderRadius: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    pointerEvents: 'none',
                                    zIndex: 2,
                                }}
                            >
                                <CircularProgress size={28} />
                            </Box>
                        )}
                    </Box>
                )}

                {!isLargeScanPending && isNormalSnapshotLoading && (
                    <Card>
                        <CardContent>
                            <Box
                                sx={{
                                    minHeight: 120,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 2,
                                }}
                            >
                                <CircularProgress size={24} />
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                >
                                    Загрузка дашборда
                                </Typography>
                            </Box>
                        </CardContent>
                    </Card>
                )}

                {!isLargeScanPending && !isNormalSnapshotLoading && analytics.parsedLines === 0 && (
                    <Alert severity="warning">
                        {t('dashboard.noParsedWarning')}
                    </Alert>
                )}

                {!isLargeScanPending && !isNormalSnapshotLoading && (
                    <>
                        <Card>
                            <CardContent>
                                {useLocalLargeMode && isHistogramLoading ? (
                                    <Box
                                        sx={{
                                            height: 160,
                                            borderRadius: 1,
                                            border: (theme) => `1px solid ${theme.palette.divider}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 2,
                                            backgroundColor: (theme) => theme.palette.background.paper,
                                        }}
                                    >
                                        <CircularProgress size={24} />
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                        >
                                            {t('dashboard.histogramBuilding', { progress: histogramProgress })}
                                        </Typography>
                                    </Box>
                                ) : (
                                    <LogHistogram
                                        parsedLines={histogramSourceLines}
                                        onTimeRangeChange={(startTime, endTime) => {
                                            applyTimeRangeSelection(startTime, endTime);
                                        }}
                                        onCategoryFilterChange={(payload) => {
                                            setHistogramCategoryFilter((prev) => {
                                                const prevSelected = prev.selectedCategories;
                                                const nextSelected = payload.selectedCategories;
                                                const sameField = prev.field === payload.field;
                                                const sameSelection = (
                                                    (prevSelected === null && nextSelected === null)
                                                    || (
                                                        prevSelected !== null
                                                        && nextSelected !== null
                                                        && prevSelected.length === nextSelected.length
                                                        && prevSelected.every((value, index) => value === nextSelected[index])
                                                    )
                                                );

                                                if (sameField && sameSelection) {
                                                    return prev;
                                                }

                                                return {
                                                    field: payload.field,
                                                    selectedCategories: nextSelected ? [...nextSelected] : null,
                                                };
                                            });
                                        }}
                                    />
                                )}
                            </CardContent>
                        </Card>

                        {hasAnyTopChartData && (
                            <Box sx={{ position: 'relative' }}>
                                <Grid
                                    container
                                    spacing={2}
                                >
                                    {hasLevelChartData && (
                                        <Grid size={{ xs: 12, md: topChartGridMd }}>
                                            <Card>
                                                <CardContent>
                                                    <ReactECharts
                                                        option={toChartOption(t('dashboard.charts.levels'), chartAnalytics.levelValues, locale)}
                                                        style={{ height: 260 }}
                                                    />
                                                </CardContent>
                                            </Card>
                                        </Grid>
                                    )}
                                    {hasStatusChartData && (
                                        <Grid size={{ xs: 12, md: topChartGridMd }}>
                                            <Card>
                                                <CardContent>
                                                    <ReactECharts
                                                        option={toChartOption(t('dashboard.charts.httpStatus'), chartAnalytics.statusValues, locale)}
                                                        style={{ height: 260 }}
                                                    />
                                                </CardContent>
                                            </Card>
                                        </Grid>
                                    )}
                                    {hasMethodChartData && (
                                        <Grid size={{ xs: 12, md: topChartGridMd }}>
                                            <Card>
                                                <CardContent>
                                                    <ReactECharts
                                                        option={toChartOption(t('dashboard.charts.httpMethods'), chartAnalytics.methodValues, locale)}
                                                        style={{ height: 260 }}
                                                    />
                                                </CardContent>
                                            </Card>
                                        </Grid>
                                    )}
                                    {hasComponentLevelChartData && (
                                        <Grid size={{ xs: 12, md: topChartGridMd }}>
                                            <Card>
                                                <CardContent>
                                                    <ReactECharts
                                                        option={toChartOption(getFieldTitle('componentLevel', t), chartAnalytics.componentLevelValues, locale)}
                                                        style={{ height: 260 }}
                                                    />
                                                </CardContent>
                                            </Card>
                                        </Grid>
                                    )}
                                </Grid>

                                {isExactRebuildInProgress && (
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            inset: 0,
                                            backgroundColor: 'rgba(255, 255, 255, 0.45)',
                                            backdropFilter: 'blur(1px)',
                                            borderRadius: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            pointerEvents: 'none',
                                            zIndex: 2,
                                        }}
                                    >
                                        <CircularProgress size={28} />
                                    </Box>
                                )}
                            </Box>
                        )}

                        {chartAnalytics.facets.length > 0 ? (
                            <Box sx={{ position: 'relative' }}>
                                <Card>
                                    <CardContent>
                                        <Typography variant="subtitle1">{t('dashboard.topFieldsTitle')}</Typography>
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                        >
                                            {t('dashboard.topFieldsDescription')}
                                        </Typography>
                                        <Divider sx={{ my: 1.5 }} />
                                        <Grid
                                            container
                                            spacing={2}
                                        >
                                            {chartAnalytics.facets.map((facet) => (
                                                <Grid
                                                    key={facet.field}
                                                    size={{ xs: 12, md: 4 }}
                                                >
                                                    <ReactECharts
                                                        option={toChartOption(getFieldTitle(facet.field, t), facet.values, locale)}
                                                        style={{ height: 260 }}
                                                    />
                                                </Grid>
                                            ))}
                                        </Grid>
                                    </CardContent>
                                </Card>

                                {isExactRebuildInProgress && (
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            inset: 0,
                                            backgroundColor: 'rgba(255, 255, 255, 0.45)',
                                            backdropFilter: 'blur(1px)',
                                            borderRadius: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            pointerEvents: 'none',
                                            zIndex: 2,
                                        }}
                                    >
                                        <CircularProgress size={28} />
                                    </Box>
                                )}
                            </Box>
                        ) : shouldShowBottomNoDataMessage ? (
                            <Card>
                                <CardContent>
                                    <Alert severity="info">
                                        Нет данных для отображения
                                    </Alert>
                                </CardContent>
                            </Card>
                        ) : null}
                    </>
                )}
            </Stack>
        </Box>
    );
};

export default DashboardPage;
