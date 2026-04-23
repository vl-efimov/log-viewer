import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import type { ParsedLogLine } from '../utils/logFormatDetector';
import { extractTimestampFromParsedLine, parseTimestamp } from '../utils/logTimestamp';

// Log level colors - consistent across different log formats
const LOG_LEVEL_COLORS: Record<string, string> = {
    // Error levels
    'EMERG': '#5d0000',
    'emerg': '#5d0000',
    'ALERT': '#7f0000',
    'alert': '#7f0000',
    'CRIT': '#9a1111',
    'crit': '#9a1111',
    'FATAL': '#b71c1c',
    'fatal': '#b71c1c',
    'CRITICAL': '#c62828',
    'critical': '#c62828',
    'ERROR': '#d84315',
    'error': '#d84315',
    'err': '#e64a19',
    'SEVERE': '#f4511e',
    'severe': '#f4511e',

    // Warning levels
    'WARN': '#ff9800',
    'warn': '#ff9800',
    'WARNING': '#ff9800',
    'warning': '#ff9800',
    'NOTICE': '#ffc107',
    'notice': '#ffc107',
    'KERNEL': '#ef6c00',
    'kernel': '#ef6c00',
    'APP': '#3949ab',
    'app': '#3949ab',

    // Info levels
    'INFO': '#2196f3',
    'info': '#2196f3',
    'INFORMATION': '#2196f3',
    'information': '#2196f3',

    // Debug levels
    'DEBUG': '#9c27b0',
    'debug': '#9c27b0',
    'TRACE': '#673ab7',
    'trace': '#673ab7',
    'FINE': '#9c27b0',
    'fine': '#9c27b0',
    'FINER': '#7b1fa2',
    'finer': '#7b1fa2',
    'FINEST': '#673ab7',
    'finest': '#673ab7',

    // Unknown/default
    'UNKNOWN': '#9e9e9e',
    'unknown': '#9e9e9e',
};

// Priority order for stacking (higher = drawn on top)
const LOG_LEVEL_PRIORITY: Record<string, number> = {
    'EMERG': 110,
    'emerg': 110,
    'ALERT': 105,
    'alert': 105,
    'CRIT': 100,
    'crit': 100,
    'FATAL': 100,
    'fatal': 100,
    'CRITICAL': 95,
    'critical': 95,
    'ERROR': 90,
    'error': 90,
    'err': 90,
    'SEVERE': 85,
    'severe': 85,
    'WARN': 70,
    'warn': 70,
    'WARNING': 70,
    'warning': 70,
    'NOTICE': 60,
    'notice': 60,
    'KERNEL': 58,
    'kernel': 58,
    'APP': 52,
    'app': 52,
    'INFO': 50,
    'info': 50,
    'DEBUG': 30,
    'debug': 30,
    'TRACE': 20,
    'trace': 20,
};

interface HistogramDataPoint {
    time: string;
    timestamp: number;
    [key: string]: string | number; // Dynamic log level counts
}

interface LogHistogramProps {
    parsedLines: Array<{
        lineNumber: number;
        parsed: ParsedLogLine | null;
        raw: string;
        error?: string;
    }>;
    /** If true, histogram is shown in collapsed state by default */
    defaultCollapsed?: boolean;
    /** Height of the chart in pixels */
    height?: number;
    /** Callback when time range changes via slider */
    onTimeRangeChange?: (startTime: number | null, endTime: number | null) => void;
    /** Callback when legend category visibility changes */
    onCategoryFilterChange?: (payload: { field: string | null; selectedCategories: string[] | null }) => void;
    /** Optional anomaly regions from backend */
    anomalyRegions?: Array<{
        start_line: number;
        end_line: number;
        start_timestamp: string | null;
        end_timestamp: string | null;
    }>;
    anomalyLineNumbers?: number[];
    onAnomalyRangeSelect?: (startLine: number, endLine: number) => void;
    showQuickRangeButtons?: boolean;
}

interface TimedParsedLine {
    lineNumber: number;
    parsed: ParsedLogLine;
    raw: string;
    timestampMs: number;
}

type QuickRangePreset = 'day' | 'week' | 'month' | 'quarter' | 'all';

interface ResolvedAnomalyRange {
    key: string;
    start: number;
    end: number;
    startLine: number;
    endLine: number;
}

const CATEGORY_FIELD_CANDIDATES = [
    'level',
    'status',
    'method',
    'type',
    'queue',
    'component',
    'host',
    'process',
    'class',
];

const CHART_CATEGORY_COLORS = ['#5C6BC0', '#26A69A', '#EF5350', '#FFA726', '#42A5F5', '#AB47BC', '#66BB6A', '#8D6E63'];

function resolveLocale(language: string): string {
    if (language === 'cz') return 'cs-CZ';
    if (language === 'ru') return 'ru-RU';
    return 'en-US';
}

function isFieldSuitableForGrouping(
    field: string,
    stats: { present: number; unique: number; maxLength: number },
    totalLines: number
): boolean {
    if (stats.present === 0 || stats.unique <= 1) {
        return false;
    }

    const presenceRatio = totalLines > 0 ? stats.present / totalLines : 0;
    if (presenceRatio < 0.2) {
        return false;
    }

    if (field === 'level') {
        return stats.unique <= 16 && stats.maxLength <= 20;
    }

    if (field === 'status') {
        // Status values are often words like RUNNING/COMPLETED, so keep this wider
        // than generic fields to preserve semantic priority over queue.
        return stats.unique <= 120 && stats.maxLength <= 24;
    }

    return stats.unique <= 12 && stats.maxLength <= 28;
}

function selectCategoryField(lines: TimedParsedLine[]): string | null {
    const statsByField = new Map<string, { present: number; unique: number; maxLength: number }>();
    for (const field of CATEGORY_FIELD_CANDIDATES) {
        let present = 0;
        const values = new Set<string>();
        let maxLength = 0;

        for (const line of lines) {
            const value = line.parsed.fields[field];
            if (!value) continue;
            const normalized = value.trim();
            if (!normalized) continue;
            present += 1;
            values.add(normalized.toUpperCase());
            if (normalized.length > maxLength) {
                maxLength = normalized.length;
            }
        }
        statsByField.set(field, { present, unique: values.size, maxLength });
    }

    // Prefer fields by semantic priority order from CATEGORY_FIELD_CANDIDATES.
    for (const field of CATEGORY_FIELD_CANDIDATES) {
        const stats = statsByField.get(field);
        if (!stats) continue;
        if (isFieldSuitableForGrouping(field, stats, lines.length)) {
            return field;
        }
    }

    return null;
}

function getCategoryColor(category: string, categoryField: string | null): string {
    if (category === 'UNKNOWN' || category === 'unknown') {
        return LOG_LEVEL_COLORS.UNKNOWN;
    }

    if (categoryField === 'level') {
        return LOG_LEVEL_COLORS[category] || LOG_LEVEL_COLORS.UNKNOWN;
    }

    let hash = 0;
    for (let i = 0; i < category.length; i += 1) {
        hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
    }

    return CHART_CATEGORY_COLORS[hash % CHART_CATEGORY_COLORS.length];
}

/**
 * Determines the appropriate time bucket size based on the log time range
 */
function calculateBucketSize(minTime: number, maxTime: number, targetBuckets: number = 50): number {
    const rangeMs = maxTime - minTime;
    if (rangeMs <= 0) return 60000; // 1 minute default

    const bucketSizes = [
        1000,           // 1 second
        5000,           // 5 seconds
        10000,          // 10 seconds
        30000,          // 30 seconds
        60000,          // 1 minute
        300000,         // 5 minutes
        600000,         // 10 minutes
        1800000,        // 30 minutes
        3600000,        // 1 hour
        7200000,        // 2 hours
        14400000,       // 4 hours
        43200000,       // 12 hours
        86400000,       // 1 day
        604800000,      // 1 week
    ];

    // Find the smallest bucket size that gives us <= targetBuckets
    for (const size of bucketSizes) {
        if (rangeMs / size <= targetBuckets) {
            return size;
        }
    }

    return bucketSizes[bucketSizes.length - 1];
}

/**
 * Formats a bucket size to human-readable string
 */
function formatBucketSize(ms: number): string {
    if (ms < 60000) return `${ms / 1000}s`;
    if (ms < 3600000) return `${ms / 60000}m`;
    if (ms < 86400000) return `${ms / 3600000}h`;
    return `${ms / 86400000}d`;
}

/**
 * Formats timestamp for display on X axis
 */
function formatTimeLabel(timestamp: number, bucketSize: number, locale: string): string {
    const date = new Date(timestamp);

    if (bucketSize >= 86400000) {
        // Day or larger: show date
        return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    } else if (bucketSize >= 3600000) {
        // Hour or larger: show date and hour
        return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    } else {
        // Smaller: show time with seconds
        return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}

function formatAxisTimeLabel(timestamp: number, rangeMs: number, bucketSize: number, locale: string): string {
    const date = new Date(timestamp);
    const monthDay = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    const monthYear = date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
    const year = date.toLocaleDateString(locale, { year: 'numeric' });
    const hhmm = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const hhmmss = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;

    // Very coarse scales: only year or month-year labels.
    if (rangeMs >= 2 * 365 * 86400000 || bucketSize >= 180 * 86400000) {
        return year;
    }

    if (rangeMs >= 180 * 86400000 || bucketSize >= 30 * 86400000) {
        return monthYear;
    }

    // Coarse day scale: date-only labels (no repeated date tick labels).
    if (bucketSize >= 86400000) {
        return monthDay;
    }

    // Mixed scale with repeated dates in one day: midnight tick uses date, others use time.
    if (bucketSize >= 60000) {
        return isMidnight ? monthDay : hhmm;
    }

    if (bucketSize >= 1000) {
        return isMidnight ? monthDay : hhmmss;
    }

    return hhmmss;
}

function parseZoomBoundary(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string') {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
            return asNumber;
        }

        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    }

    if (value instanceof Date) {
        const ts = value.getTime();
        return Number.isFinite(ts) ? ts : null;
    }

    return null;
}

function subtractMonths(timestamp: number, months: number): number {
    const date = new Date(timestamp);
    date.setMonth(date.getMonth() - months);
    return date.getTime();
}

/**
 * LogHistogram component - displays a histogram of log entries over time,
 * with stacked bars colored by log level and a range slider
 */
export const LogHistogram: React.FC<LogHistogramProps> = ({
    parsedLines,
    defaultCollapsed = false,
    height = 180,
    onTimeRangeChange,
    onCategoryFilterChange,
    anomalyRegions,
    anomalyLineNumbers,
    onAnomalyRangeSelect,
    showQuickRangeButtons = true,
}) => {
    const { i18n } = useTranslation();
    const locale = useMemo(() => resolveLocale(i18n.language), [i18n.language]);
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
    const [selectedRange, setSelectedRange] = useState<{ start: number | null; end: number | null }>({
        start: null,
        end: null,
    });
    const [zoomShade, setZoomShade] = useState<{ leftPercent: number; rightPercent: number }>({
        leftPercent: 0,
        rightPercent: 0,
    });
    const [hoveredAnomalyRangeKey, setHoveredAnomalyRangeKey] = useState<string | null>(null);
    const [hoveredAnomalyPointer, setHoveredAnomalyPointer] = useState<{ x: number; y: number } | null>(null);
    const [sliderReadyVersion, setSliderReadyVersion] = useState(0);
    const [legendSelection, setLegendSelection] = useState<Record<string, boolean>>({});
    const [activeQuickRange, setActiveQuickRange] = useState<QuickRangePreset | null>(null);
    const zoomSliderRef = useRef<ReactECharts | null>(null);
    const quickRangeDispatchRef = useRef(false);

    const { validLines, timeRange } = useMemo(() => {
        // Extract lines with valid timestamps from any known time fields.
        const parsedWithRealTimestamps: TimedParsedLine[] = parsedLines.flatMap((line) => {
            if (!line.parsed) {
                return [];
            }

            const timestampMs = extractTimestampFromParsedLine(line.parsed);
            if (timestampMs === null) {
                return [];
            }

            return [{
                lineNumber: line.lineNumber,
                parsed: line.parsed,
                raw: line.raw,
                timestampMs,
            }];
        });

        const validLines: TimedParsedLine[] = parsedWithRealTimestamps;

        if (validLines.length === 0) {
            return { validLines: [], timeRange: null };
        }

        // Use an iterative scan to avoid stack overflow on very large arrays.
        let minTime = validLines[0].timestampMs;
        let maxTime = validLines[0].timestampMs;
        for (let i = 1; i < validLines.length; i += 1) {
            const ts = validLines[i].timestampMs;
            if (ts < minTime) {
                minTime = ts;
            }
            if (ts > maxTime) {
                maxTime = ts;
            }
        }

        return {
            validLines,
            timeRange: { min: minTime, max: maxTime },
        };
    }, [parsedLines]);

    const categoryField = useMemo(() => selectCategoryField(validLines), [validLines]);

    const buildHistogram = useCallback((
        lines: typeof validLines,
        range: { start: number; end: number },
        targetBuckets?: number
    ) => {
        if (lines.length === 0) {
            return { chartData: [], logLevels: [], bucketSize: 60000 };
        }

        const bucketSize = calculateBucketSize(range.start, range.end, targetBuckets);
        const buckets: Map<number, Record<string, number>> = new Map();
        const categorySet = new Set<string>();

        lines.forEach(line => {
            const ts = line.timestampMs;
            if (ts < range.start || ts > range.end) return;
            const bucketKey = Math.floor(ts / bucketSize) * bucketSize;
            const category = categoryField
                ? (line.parsed.fields[categoryField] || 'UNKNOWN').toUpperCase()
                : 'UNKNOWN';

            categorySet.add(category);

            if (!buckets.has(bucketKey)) {
                buckets.set(bucketKey, {});
            }
            const bucket = buckets.get(bucketKey)!;
            bucket[category] = (bucket[category] || 0) + 1;
        });

        const logLevels = Array.from(categorySet).sort((a, b) => {
            const priorityA = LOG_LEVEL_PRIORITY[a] || 0;
            const priorityB = LOG_LEVEL_PRIORITY[b] || 0;
            return priorityA - priorityB;
        });

        const chartData: HistogramDataPoint[] = Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([timestamp, levels]) => ({
                time: formatTimeLabel(timestamp, bucketSize, locale),
                timestamp,
                ...levels,
            }));

        return { chartData, logLevels, bucketSize };
    }, [categoryField, locale]);

    const fullHistogram = useMemo(() => {
        if (!timeRange) {
            return { chartData: [], logLevels: [], bucketSize: 60000 };
        }
        return buildHistogram(validLines, { start: timeRange.min, end: timeRange.max });
    }, [validLines, timeRange, buildHistogram]);

    const zoomHistogram = useMemo(() => {
        if (!timeRange) {
            return { chartData: [], logLevels: [], bucketSize: 60000 };
        }
        return buildHistogram(validLines, { start: timeRange.min, end: timeRange.max }, 200);
    }, [validLines, timeRange, buildHistogram]);

    const mainHistogram = useMemo(() => {
        if (!timeRange) {
            return { chartData: [], logLevels: [], bucketSize: 60000 };
        }

        const start = selectedRange.start ?? timeRange.min;
        const end = selectedRange.end ?? timeRange.max;

        return buildHistogram(validLines, { start, end });
    }, [validLines, timeRange, selectedRange, buildHistogram]);

    useEffect(() => {
        setLegendSelection((prev) => {
            const next: Record<string, boolean> = {};
            mainHistogram.logLevels.forEach((level) => {
                next[level] = prev[level] ?? true;
            });
            return next;
        });
    }, [mainHistogram.logLevels]);

    const selectedCategories = useMemo(() => {
        return mainHistogram.logLevels.filter((level) => legendSelection[level] !== false);
    }, [legendSelection, mainHistogram.logLevels]);

    useEffect(() => {
        if (!onCategoryFilterChange) {
            return;
        }

        const hasActiveFilter = selectedCategories.length > 0
            && selectedCategories.length < mainHistogram.logLevels.length;

        onCategoryFilterChange({
            field: categoryField,
            selectedCategories: hasActiveFilter ? selectedCategories : null,
        });
    }, [categoryField, mainHistogram.logLevels.length, onCategoryFilterChange, selectedCategories]);

    const handleLegendSelectChanged = useCallback((params: {
        selected?: Record<string, boolean>;
    }) => {
        if (!params.selected) {
            return;
        }

        setLegendSelection((prev) => {
            const next: Record<string, boolean> = {};
            mainHistogram.logLevels.forEach((level) => {
                const selected = params.selected?.[level];
                next[level] = typeof selected === 'boolean' ? selected : (prev[level] ?? true);
            });
            return next;
        });
    }, [mainHistogram.logLevels]);

    const zoomSliderGrid = {
        top: 6,
        right: 20,
        left: 40,
        bottom: 28,
    };

    const zoomChartGrid = {
        ...zoomSliderGrid,
        top: 6,
        bottom: 22,
    };

    useEffect(() => {
        if (!timeRange) return;
        setZoomShade({ leftPercent: 0, rightPercent: 0 });
    }, [timeRange?.min, timeRange?.max]);

    useEffect(() => {
        if (!timeRange) {
            setSelectedRange({ start: null, end: null });
            return;
        }

        setSelectedRange((prev) => {
            if (prev.start === null && prev.end === null) {
                return prev;
            }

            const outOfBounds = (prev.start !== null && (prev.start < timeRange.min || prev.start > timeRange.max))
                || (prev.end !== null && (prev.end < timeRange.min || prev.end > timeRange.max));

            if (!outOfBounds) {
                return prev;
            }

            return { start: null, end: null };
        });
    }, [timeRange?.min, timeRange?.max]);

    const chartOption = useMemo(() => {
        const bucketMidOffset = Math.floor(mainHistogram.bucketSize / 2);
        const series = mainHistogram.logLevels.map(level => ({
            name: level,
            type: 'bar',
            stack: 'total',
            emphasis: { focus: 'series' },
            itemStyle: { color: getCategoryColor(level, categoryField) },
            data: mainHistogram.chartData.map(point => [
                point.timestamp + bucketMidOffset,
                typeof point[level] === 'number' ? point[level] : 0,
            ]),
        }));

        const selectedStart = selectedRange.start ?? timeRange?.min ?? 0;
        const selectedEnd = selectedRange.end ?? timeRange?.max ?? selectedStart;
        const selectedRangeMs = Math.max(1, selectedEnd - selectedStart);
        const splitNumber = selectedRangeMs <= 3600000
            ? 16
            : selectedRangeMs <= 6 * 3600000
                ? 14
                : selectedRangeMs <= 86400000
                    ? 14
                    : selectedRangeMs <= 7 * 86400000
                        ? 16
                        : selectedRangeMs <= 30 * 86400000
                            ? 14
                            : 12;

        return {
            tooltip: { trigger: 'axis' },
            legend: {
                top: 0,
                selected: legendSelection,
            },
            grid: { top: 20, right: 20, left: 40, bottom: 10 },
            xAxis: {
                type: 'time',
                min: selectedStart,
                max: selectedEnd,
                splitNumber,
                axisLabel: {
                    fontSize: 10,
                    hideOverlap: false,
                    showMinLabel: true,
                    showMaxLabel: true,
                    formatter: (value: number) => formatAxisTimeLabel(value, selectedRangeMs, mainHistogram.bucketSize, locale),
                },
            },
            yAxis: {
                type: 'value',
                axisLabel: { fontSize: 10 },
            },
            series,
        };
    }, [categoryField, legendSelection, locale, mainHistogram, selectedRange, timeRange]);

    const resolvedAnomalyRanges = useMemo((): ResolvedAnomalyRange[] => {
        const zoomLineMinX = timeRange?.min ?? null;
        const zoomLineMaxX = timeRange?.max ?? null;

        const sanitizeRanges = <T extends { start: number; end: number; startLine: number; endLine: number }>(ranges: T[]): T[] => (
            ranges
                .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
                .sort((a, b) => a.start - b.start)
        );

        const sortedValid = [...validLines].sort((a, b) => a.lineNumber - b.lineNumber);
        const timestampByLine = new Map<number, number>();
        const validLineNumbers: number[] = [];
        for (const line of sortedValid) {
            timestampByLine.set(line.lineNumber, line.timestampMs);
            validLineNumbers.push(line.lineNumber);
        }

        const lowerBound = (arr: number[], value: number): number => {
            let left = 0;
            let right = arr.length;
            while (left < right) {
                const mid = Math.floor((left + right) / 2);
                if (arr[mid] < value) {
                    left = mid + 1;
                } else {
                    right = mid;
                }
            }
            return left;
        };

        const resolveStartTimestamp = (startLine: number, endLine: number): number | null => {
            const direct = timestampByLine.get(startLine);
            if (direct !== undefined) {
                return direct;
            }

            const idx = lowerBound(validLineNumbers, startLine);
            if (idx >= validLineNumbers.length) {
                return null;
            }
            const candidateLine = validLineNumbers[idx];
            if (candidateLine > endLine) {
                return resolveNearestTimestamp(startLine);
            }
            return timestampByLine.get(candidateLine) ?? null;
        };

        const resolveEndTimestamp = (startLine: number, endLine: number): number | null => {
            const direct = timestampByLine.get(endLine);
            if (direct !== undefined) {
                return direct;
            }

            const idx = lowerBound(validLineNumbers, endLine + 1) - 1;
            if (idx < 0) {
                return null;
            }
            const candidateLine = validLineNumbers[idx];
            if (candidateLine < startLine) {
                return resolveNearestTimestamp(endLine);
            }
            return timestampByLine.get(candidateLine) ?? null;
        };

        const resolveNearestTimestamp = (lineNumber: number): number | null => {
            if (validLineNumbers.length === 0) {
                return null;
            }

            const idx = lowerBound(validLineNumbers, lineNumber);
            if (idx <= 0) {
                return timestampByLine.get(validLineNumbers[0]) ?? null;
            }
            if (idx >= validLineNumbers.length) {
                return timestampByLine.get(validLineNumbers[validLineNumbers.length - 1]) ?? null;
            }

            const leftLine = validLineNumbers[idx - 1];
            const rightLine = validLineNumbers[idx];
            const leftDistance = Math.abs(lineNumber - leftLine);
            const rightDistance = Math.abs(rightLine - lineNumber);
            const nearest = leftDistance <= rightDistance ? leftLine : rightLine;
            return timestampByLine.get(nearest) ?? null;
        };

        const fromLines = (() => {
            if (!anomalyLineNumbers || anomalyLineNumbers.length === 0) {
                return [] as Array<{ start: number; end: number; startLine: number; endLine: number }>;
            }

            const sortedLines = Array.from(new Set(anomalyLineNumbers)).sort((a, b) => a - b);
            if (sortedValid.length === 0) {
                return [] as Array<{ start: number; end: number; startLine: number; endLine: number }>;
            }

            const presentLineNumbers = new Set(parsedLines.map((line) => line.lineNumber));
            const isGapOnlyHiddenLines = (fromLineExclusive: number, toLineExclusive: number): boolean => {
                for (let lineNo = fromLineExclusive + 1; lineNo < toLineExclusive; lineNo += 1) {
                    if (presentLineNumbers.has(lineNo)) {
                        return false;
                    }
                }
                return true;
            };

            const runs: Array<{ startLine: number; endLine: number }> = [];
            for (const lineNumber of sortedLines) {
                const last = runs[runs.length - 1];
                if (!last) {
                    runs.push({ startLine: lineNumber, endLine: lineNumber });
                    continue;
                }

                const isDirectlyAdjacent = lineNumber <= (last.endLine + 1);
                const canMergeThroughHiddenGap = !isDirectlyAdjacent
                    && isGapOnlyHiddenLines(last.endLine, lineNumber);

                if (isDirectlyAdjacent || canMergeThroughHiddenGap) {
                    last.endLine = lineNumber;
                } else {
                    runs.push({ startLine: lineNumber, endLine: lineNumber });
                }
            }

            return runs.flatMap((run) => {
                // Build time bounds from all valid lines inside the run. This keeps
                // overlays correct even when file line order is not chronological.
                const rangeStartIndex = lowerBound(validLineNumbers, run.startLine);
                const rangeEndExclusive = lowerBound(validLineNumbers, run.endLine + 1);

                let minTs = Number.POSITIVE_INFINITY;
                let maxTs = Number.NEGATIVE_INFINITY;
                for (let i = rangeStartIndex; i < rangeEndExclusive; i += 1) {
                    const ts = timestampByLine.get(validLineNumbers[i]);
                    if (ts === undefined) {
                        continue;
                    }
                    if (ts < minTs) {
                        minTs = ts;
                    }
                    if (ts > maxTs) {
                        maxTs = ts;
                    }
                }

                const hasInternalTimestamps = Number.isFinite(minTs) && Number.isFinite(maxTs);
                const startCandidate = hasInternalTimestamps ? minTs : resolveStartTimestamp(run.startLine, run.endLine);
                const endCandidate = hasInternalTimestamps ? maxTs : resolveEndTimestamp(run.startLine, run.endLine);

                if (startCandidate === null || endCandidate === null) {
                    return [];
                }

                const rawStart = Math.min(startCandidate, endCandidate);
                const rawEndBase = Math.max(startCandidate, endCandidate);
                const rawEnd = rawEndBase === rawStart ? rawStart + 1 : rawEndBase;

                const clampedStart = zoomLineMinX !== null ? Math.max(zoomLineMinX, rawStart) : rawStart;
                const clampedEnd = zoomLineMaxX !== null ? Math.min(zoomLineMaxX, rawEnd) : rawEnd;

                if (clampedEnd <= clampedStart) {
                    return [];
                }

                return [{ start: clampedStart, end: clampedEnd, startLine: run.startLine, endLine: run.endLine }];
            });
        })();

        const fromRegions = (() => {
            return (anomalyRegions || []).flatMap((region) => {
                const startLine = Math.min(region.start_line, region.end_line);
                const endLine = Math.max(region.start_line, region.end_line);

                const rangeStartIndex = lowerBound(validLineNumbers, startLine);
                const rangeEndExclusive = lowerBound(validLineNumbers, endLine + 1);

                let minTs = Number.POSITIVE_INFINITY;
                let maxTs = Number.NEGATIVE_INFINITY;
                for (let i = rangeStartIndex; i < rangeEndExclusive; i += 1) {
                    const ts = timestampByLine.get(validLineNumbers[i]);
                    if (ts === undefined) {
                        continue;
                    }
                    if (ts < minTs) {
                        minTs = ts;
                    }
                    if (ts > maxTs) {
                        maxTs = ts;
                    }
                }

                const hasInternalTimestamps = Number.isFinite(minTs) && Number.isFinite(maxTs);
                const startCandidate = hasInternalTimestamps
                    ? minTs
                    : (
                        resolveStartTimestamp(startLine, endLine)
                        ?? (region.start_timestamp ? parseTimestamp(region.start_timestamp)?.getTime() ?? null : null)
                    );
                const endCandidate = hasInternalTimestamps
                    ? maxTs
                    : (
                        resolveEndTimestamp(startLine, endLine)
                        ?? (region.end_timestamp ? parseTimestamp(region.end_timestamp)?.getTime() ?? null : null)
                    );

                if (startCandidate === null || endCandidate === null) {
                    return [];
                }

                const rawStart = Math.min(startCandidate, endCandidate);
                const rawEndBase = Math.max(startCandidate, endCandidate);
                const rawEnd = rawEndBase === rawStart ? rawStart + 1 : rawEndBase;

                const clampedStart = zoomLineMinX !== null ? Math.max(zoomLineMinX, rawStart) : rawStart;
                const clampedEnd = zoomLineMaxX !== null ? Math.min(zoomLineMaxX, rawEnd) : rawEnd;

                if (clampedEnd <= clampedStart) {
                    return [];
                }

                return [{
                    start: clampedStart,
                    end: clampedEnd,
                    startLine,
                    endLine,
                }];
            });
        })();

        // Prefer anomalyLineNumbers when available, otherwise use server regions.
        const ranges = fromLines.length > 0 ? fromLines : fromRegions;
        return sanitizeRanges(ranges).map((range, index) => ({
            ...range,
            key: `${index}:${range.startLine}:${range.endLine}:${Math.round(range.start)}:${Math.round(range.end)}`,
        }));
    }, [anomalyLineNumbers, anomalyRegions, parsedLines, timeRange, validLines]);

    const hoveredAnomalyRange = useMemo(() => (
        resolvedAnomalyRanges.find((range) => range.key === hoveredAnomalyRangeKey) ?? null
    ), [hoveredAnomalyRangeKey, resolvedAnomalyRanges]);

    useEffect(() => {
        if (resolvedAnomalyRanges.length === 0) {
            setHoveredAnomalyRangeKey(null);
            setHoveredAnomalyPointer(null);
            return;
        }

        if (!hoveredAnomalyRangeKey) {
            setHoveredAnomalyPointer(null);
            return;
        }

        const stillExists = resolvedAnomalyRanges.some((range) => range.key === hoveredAnomalyRangeKey);
        if (!stillExists) {
            setHoveredAnomalyRangeKey(null);
            setHoveredAnomalyPointer(null);
        }
    }, [hoveredAnomalyRangeKey, resolvedAnomalyRanges]);

    const findAnomalyRangeByTime = useCallback((timestamp: number): ResolvedAnomalyRange | null => {
        const matches = resolvedAnomalyRanges.filter((range) => timestamp >= range.start && timestamp <= range.end);
        if (matches.length === 0) {
            return null;
        }
        if (matches.length === 1) {
            return matches[0];
        }

        let best = matches[0];
        let minDistance = Number.POSITIVE_INFINITY;
        for (const range of matches) {
            const center = (range.start + range.end) / 2;
            const distance = Math.abs(center - timestamp);
            if (distance < minDistance) {
                minDistance = distance;
                best = range;
            }
        }

        return best;
    }, [resolvedAnomalyRanges]);

    const resolveTimestampFromPixel = useCallback((offsetX: number, offsetY: number): number | null => {
        const chart = zoomSliderRef.current?.getEchartsInstance();
        if (!chart) {
            return null;
        }

        const hasModel = typeof (chart as unknown as { getModel?: () => unknown }).getModel === 'function'
            ? (chart as unknown as { getModel: () => unknown }).getModel() !== null
            : false;

        if (hasModel) {
            try {
                const converted = chart.convertFromPixel({ xAxisIndex: 0 }, [offsetX, offsetY]);
                if (Array.isArray(converted) && typeof converted[0] === 'number' && Number.isFinite(converted[0])) {
                    return converted[0];
                }
                if (typeof converted === 'number' && Number.isFinite(converted)) {
                    return converted;
                }
            } catch {
                // Fall back to proportional mapping while chart finishes init.
            }
        }

        if (timeRange) {
            const chartWidth = chart.getWidth();
            const axisLeft = zoomSliderGrid.left;
            const axisRight = chartWidth - zoomSliderGrid.right;
            const axisWidth = Math.max(1, axisRight - axisLeft);
            const normalizedX = Math.max(0, Math.min(1, (offsetX - axisLeft) / axisWidth));
            return timeRange.min + ((timeRange.max - timeRange.min) * normalizedX);
        }

        return null;
    }, [timeRange]);

    const handleAnomalyHover = useCallback((timestamp: number | null, pointer?: { x: number; y: number }) => {
        if (timestamp === null) {
            setHoveredAnomalyRangeKey(null);
            setHoveredAnomalyPointer(null);
            return;
        }

        const hovered = findAnomalyRangeByTime(timestamp);
        setHoveredAnomalyRangeKey(hovered?.key ?? null);
        if (hovered && pointer) {
            setHoveredAnomalyPointer(pointer);
        } else {
            setHoveredAnomalyPointer(null);
        }
    }, [findAnomalyRangeByTime]);

    const clearAnomalyHover = useCallback(() => {
        setHoveredAnomalyRangeKey(null);
        setHoveredAnomalyPointer(null);
    }, []);

    const handleAnomalyClick = useCallback((timestamp: number | null) => {
        if (!onAnomalyRangeSelect) {
            return;
        }

        const hovered = hoveredAnomalyRangeKey
            ? resolvedAnomalyRanges.find((range) => range.key === hoveredAnomalyRangeKey) ?? null
            : null;
        if (hovered) {
            onAnomalyRangeSelect(hovered.startLine, hovered.endLine);
            return;
        }

        if (timestamp === null) {
            return;
        }

        const range = findAnomalyRangeByTime(timestamp);
        if (!range) {
            return;
        }

        onAnomalyRangeSelect(range.startLine, range.endLine);
    }, [findAnomalyRangeByTime, hoveredAnomalyRangeKey, onAnomalyRangeSelect, resolvedAnomalyRanges]);

    useEffect(() => {
        const chart = zoomSliderRef.current?.getEchartsInstance();
        if (!chart) {
            return;
        }

        const zr = chart.getZr();
        zr.setCursorStyle('pointer');

        const onMove = (event: { offsetX?: number; offsetY?: number }) => {
            if (typeof event.offsetX !== 'number' || typeof event.offsetY !== 'number') {
                handleAnomalyHover(null);
                return;
            }
            handleAnomalyHover(
                resolveTimestampFromPixel(event.offsetX, event.offsetY),
                { x: event.offsetX, y: event.offsetY },
            );
        };

        const onClick = (event: { offsetX?: number; offsetY?: number }) => {
            if (typeof event.offsetX !== 'number' || typeof event.offsetY !== 'number') {
                return;
            }
            handleAnomalyClick(resolveTimestampFromPixel(event.offsetX, event.offsetY));
        };

        const onOut = () => {
            clearAnomalyHover();
            zr.setCursorStyle('pointer');
        };

        zr.on('mousemove', onMove);
        zr.on('click', onClick);
        zr.on('globalout', onOut);

        return () => {
            zr.off('mousemove', onMove);
            zr.off('click', onClick);
            zr.off('globalout', onOut);
        };
    }, [
        clearAnomalyHover,
        handleAnomalyClick,
        handleAnomalyHover,
        resolveTimestampFromPixel,
        sliderReadyVersion,
        timeRange?.max,
        timeRange?.min,
    ]);

    const zoomChartOption = useMemo(() => {
        const zoomBucketMidOffset = Math.floor(zoomHistogram.bucketSize / 2);
        const zoomRangeMs = timeRange ? Math.max(1, timeRange.max - timeRange.min) : 1;
        const effectiveMarkAreaData = resolvedAnomalyRanges.map((range) => ([
            {
                xAxis: range.start,
                itemStyle: {
                    color: range.key === hoveredAnomalyRangeKey
                        ? 'rgba(236, 64, 122, 0.5)'
                        : 'rgba(255,182,193,0.35)',
                },
            },
            {
                xAxis: range.end,
            },
        ]));

        const totals = zoomHistogram.chartData.map(point =>
            zoomHistogram.logLevels.reduce((sum, level) => sum + (typeof point[level] === 'number' ? (point[level] as number) : 0), 0)
        );

        return {
            tooltip: { show: false },
            grid: zoomChartGrid,
            xAxis: {
                type: 'time',
                min: timeRange?.min,
                max: timeRange?.max,
                splitNumber: 6,
                axisLabel: {
                    show: true,
                    fontSize: 10,
                    hideOverlap: false,
                    showMinLabel: true,
                    showMaxLabel: true,
                    formatter: (value: number) => formatAxisTimeLabel(value, zoomRangeMs, zoomHistogram.bucketSize, locale),
                },
                axisTick: { show: true },
                axisLine: { show: true },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                axisLabel: { show: false },
                splitLine: { show: false },
                axisLine: { show: false },
                axisTick: { show: false },
            },
            series: [
                {
                    type: 'line',
                    cursor: 'pointer',
                    data: zoomHistogram.chartData.map((point, index) => [point.timestamp + zoomBucketMidOffset, totals[index]]),
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#90caf9' },
                    markArea: effectiveMarkAreaData.length > 0
                        ? {
                            silent: false,
                            data: effectiveMarkAreaData,
                        }
                        : undefined,
                },
            ],
        };
    }, [hoveredAnomalyRangeKey, locale, resolvedAnomalyRanges, timeRange, zoomHistogram]);

    const zoomSliderOption = useMemo(() => {
        if (!timeRange) {
            return {};
        }

        return {
            animation: false,
            backgroundColor: 'rgba(0, 0, 0, 0)',
            grid: zoomSliderGrid,
            xAxis: {
                type: 'time',
                min: timeRange.min,
                max: timeRange.max,
                axisLabel: { show: false },
                axisTick: { show: false },
                axisLine: { show: false },
                splitLine: { show: false },
            },
            yAxis: {
                type: 'value',
                axisLabel: { show: false },
                splitLine: { show: false },
                axisLine: { show: false },
                axisTick: { show: false },
            },
            series: [],
            dataZoom: [
                {
                    type: 'slider',
                    xAxisIndex: 0,
                    filterMode: 'none',
                    realtime: true,
                    throttle: 8,
                    height: '100%',
                    top: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    fillerColor: 'rgba(0, 0, 0, 0)',
                    dataBackground: {
                        lineStyle: { color: 'rgba(0, 0, 0, 0)' },
                        areaStyle: { color: 'rgba(0, 0, 0, 0)' },
                    },
                    selectedDataBackground: {
                        lineStyle: { color: 'rgba(0, 0, 0, 0)' },
                        areaStyle: { color: 'rgba(0, 0, 0, 0)' },
                    },
                    borderColor: 'rgba(0, 0, 0, 0.2)',
                    moveHandleSize: 14,
                    showDataShadow: false,
                    handleSize: '100%',
                    brushSelect: false,
                    zoomLock: false,
                    handleIcon: 'path://M50,0 L50,100 M44,40 L56,40 L56,60 L44,60 Z M47,44 L47,56 M53,44 L53,56',
                    handleStyle: {
                        color: '#b0b0b0',
                        borderColor: '#7a7a7a',
                        opacity: 1,
                    },
                },
            ],
        };
    }, [timeRange, zoomSliderGrid]);

    const handleZoom = useCallback((params: {
        start?: number;
        end?: number;
        startValue?: number | string | Date;
        endValue?: number | string | Date;
        batch?: Array<{ start?: number; end?: number; startValue?: number | string | Date; endValue?: number | string | Date }>;
    }) => {
        if (!timeRange || zoomHistogram.chartData.length === 0) return;

        const isQuickRangeDispatch = quickRangeDispatchRef.current;
        quickRangeDispatchRef.current = false;
        if (!isQuickRangeDispatch) {
            setActiveQuickRange(null);
        }

        const payload = params?.batch?.[0] ?? params ?? {};
        const parsedStartValue = parseZoomBoundary(payload.startValue ?? params.startValue);
        const parsedEndValue = parseZoomBoundary(payload.endValue ?? params.endValue);

        let startTime = timeRange.min;
        let endTime = timeRange.max;
        const fullWindowMs = Math.max(1, timeRange.max - timeRange.min);

        const isLikelyAbsoluteRange = (
            parsedStartValue !== null
            && parsedEndValue !== null
            && parsedStartValue >= (timeRange.min - fullWindowMs)
            && parsedStartValue <= (timeRange.max + fullWindowMs)
            && parsedEndValue >= (timeRange.min - fullWindowMs)
            && parsedEndValue <= (timeRange.max + fullWindowMs)
        );

        if (isLikelyAbsoluteRange && parsedStartValue !== null && parsedEndValue !== null) {
            startTime = Math.max(timeRange.min, Math.floor(parsedStartValue));
            endTime = Math.min(timeRange.max, Math.ceil(parsedEndValue));
        } else {
            const startPercent = typeof payload.start === 'number' ? payload.start : (typeof params.start === 'number' ? params.start : 0);
            const endPercent = typeof payload.end === 'number' ? payload.end : (typeof params.end === 'number' ? params.end : 100);
            startTime = timeRange.min + ((timeRange.max - timeRange.min) * startPercent) / 100;
            endTime = timeRange.min + ((timeRange.max - timeRange.min) * endPercent) / 100;
        }

        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
            return;
        }

        if (startTime > endTime) {
            const tmp = startTime;
            startTime = endTime;
            endTime = tmp;
        }

        const minWindowMs = Math.max(1000, Math.min(60_000, Math.floor(fullWindowMs / 250)));

        if (endTime <= startTime) {
            if (startTime >= timeRange.max) {
                startTime = Math.max(timeRange.min, timeRange.max - minWindowMs);
                endTime = timeRange.max;
            } else {
                endTime = Math.min(timeRange.max, startTime + minWindowMs);
            }
        }

        const total = Math.max(1, timeRange.max - timeRange.min);
        const leftPercent = Math.max(0, Math.min(100, ((startTime - timeRange.min) / total) * 100));
        const rightPercent = Math.max(0, Math.min(100, ((timeRange.max - endTime) / total) * 100));
        const edgeToleranceMs = Math.max(1, Math.min(1000, Math.floor(total * 0.00001)));
        const isFullRange =
            startTime <= timeRange.min + edgeToleranceMs &&
            endTime >= timeRange.max - edgeToleranceMs;

        if (isFullRange) {
            setSelectedRange({ start: null, end: null });
            setZoomShade({ leftPercent: 0, rightPercent: 0 });
            if (onTimeRangeChange) {
                onTimeRangeChange(null, null);
            }
            return;
        }

        setZoomShade({ leftPercent, rightPercent });
        setSelectedRange({ start: startTime, end: endTime });
        if (onTimeRangeChange) {
            onTimeRangeChange(startTime, endTime);
        }
    }, [onTimeRangeChange, timeRange, zoomHistogram]);

    const handleQuickRangeSelect = useCallback((preset: QuickRangePreset) => {
        if (!timeRange) {
            return;
        }

        const nowMs = Date.now();
        let startMs: number;
        let endMs = nowMs;

        if (preset === 'all') {
            startMs = timeRange.min;
            endMs = timeRange.max;
        } else if (preset === 'day') {
            startMs = nowMs - (24 * 60 * 60 * 1000);
        } else if (preset === 'week') {
            startMs = nowMs - (7 * 24 * 60 * 60 * 1000);
        } else if (preset === 'month') {
            startMs = subtractMonths(nowMs, 1);
        } else {
            startMs = subtractMonths(nowMs, 3);
        }

        const hasDataInRequestedPeriod = preset === 'all'
            ? validLines.length > 0
            : validLines.some((line) => line.timestampMs >= startMs && line.timestampMs <= endMs);

        setActiveQuickRange(preset);

        const chart = zoomSliderRef.current?.getEchartsInstance();
        if (!chart) {
            return;
        }

        if (preset !== 'all' && !hasDataInRequestedPeriod) {
            // Keep the requested period even if it is outside file bounds,
            // so parent analytics receive an empty window and show zeros.
            setSelectedRange({ start: startMs, end: endMs });
            setZoomShade({ leftPercent: 0, rightPercent: 0 });
            if (onTimeRangeChange) {
                onTimeRangeChange(startMs, endMs);
            }
            return;
        }

        quickRangeDispatchRef.current = true;
        if (preset === 'all') {
            chart.dispatchAction({
                type: 'dataZoom',
                dataZoomIndex: 0,
                start: 0,
                end: 100,
            });
            return;
        }

        chart.dispatchAction({
            type: 'dataZoom',
            dataZoomIndex: 0,
            startValue: startMs,
            endValue: endMs,
        });
    }, [onTimeRangeChange, timeRange, validLines]);

    // Don't render if no valid data
    if (fullHistogram.chartData.length === 0) {
        return null;
    }

    return (
        <Box sx={{ mb: 1 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    userSelect: 'none',
                }}
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <Typography
                    variant="subtitle2"
                    sx={{ flexGrow: 1 }}
                >
                    Log Timeline
                    <Typography
                        component="span"
                        variant="caption"
                        sx={{ ml: 1, color: 'text.secondary' }}
                    >
                        ({mainHistogram.chartData.length} intervals, {formatBucketSize(mainHistogram.bucketSize)} each)
                    </Typography>
                    {categoryField && (
                        <Typography
                            component="span"
                            variant="caption"
                            sx={{ ml: 1, color: 'text.secondary' }}
                        >
                            grouped by {categoryField}
                        </Typography>
                    )}
                </Typography>
                <Tooltip title={isCollapsed ? 'Expand histogram' : 'Collapse histogram'}>
                    <IconButton size="small">
                        {isCollapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
                    </IconButton>
                </Tooltip>
            </Box>

            <Collapse in={!isCollapsed}>
                <Box
                    sx={{
                        backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#fafafa',
                        borderRadius: 1,
                        p: 1,
                        mt: 0.5,
                        border: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <ReactECharts
                        option={chartOption}
                        style={{ height }}
                        notMerge={true}
                        onEvents={{ legendselectchanged: handleLegendSelectChanged }}
                    />
                    <Box sx={{ mt: 1 }}>
                        <Box sx={{ position: 'relative' }}>
                            <ReactECharts
                                option={zoomChartOption}
                                style={{ height: 96, cursor: 'pointer' }}
                                notMerge={true}
                            />
                            {hoveredAnomalyRange && hoveredAnomalyPointer && (
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        left: `${hoveredAnomalyPointer.x}px`,
                                        top: `${Math.max(16, hoveredAnomalyPointer.y - 8)}px`,
                                        transform: 'translate(-50%, -100%)',
                                        px: 1,
                                        py: 0.25,
                                        borderRadius: 1,
                                        backgroundColor: 'rgba(236, 64, 122, 0.92)',
                                        color: '#fff',
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        pointerEvents: 'none',
                                        zIndex: 30,
                                        whiteSpace: 'nowrap',
                                        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                                    }}
                                >
                                    {hoveredAnomalyRange.startLine} - {hoveredAnomalyRange.endLine}
                                </Box>
                            )}
                            <Box sx={{ position: 'absolute', inset: 0 }}>
                                <ReactECharts
                                    ref={zoomSliderRef}
                                    option={zoomSliderOption}
                                    style={{ height: '100%', cursor: 'grab' }}
                                    onChartReady={() => setSliderReadyVersion((v) => v + 1)}
                                    onEvents={{ datazoom: handleZoom }}
                                />
                            </Box>
                            <Box
                                sx={{
                                    position: 'absolute',
                                    top: zoomChartGrid.top,
                                    left: `${zoomSliderGrid.left + 6}px`,
                                    right: `${zoomSliderGrid.right - 6}px`,
                                    bottom: 0,
                                    pointerEvents: 'none',
                                }}
                            >
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        bottom: 0,
                                        width: `${zoomShade.leftPercent}%`,
                                        backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                    }}
                                />
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        top: 0,
                                        right: 0,
                                        bottom: 0,
                                        width: `${zoomShade.rightPercent}%`,
                                        backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                    }}
                                />
                            </Box>
                        </Box>
                    </Box>
                </Box>
                {showQuickRangeButtons && (
                    <Box
                        sx={{
                            mt: 1,
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 1,
                        }}
                    >
                        <Button
                            size="small"
                            variant={activeQuickRange === 'day' ? 'contained' : 'outlined'}
                            onClick={() => handleQuickRangeSelect('day')}
                        >
                            День
                        </Button>
                        <Button
                            size="small"
                            variant={activeQuickRange === 'week' ? 'contained' : 'outlined'}
                            onClick={() => handleQuickRangeSelect('week')}
                        >
                            Неделя
                        </Button>
                        <Button
                            size="small"
                            variant={activeQuickRange === 'month' ? 'contained' : 'outlined'}
                            onClick={() => handleQuickRangeSelect('month')}
                        >
                            Месяц
                        </Button>
                        <Button
                            size="small"
                            variant={activeQuickRange === 'quarter' ? 'contained' : 'outlined'}
                            onClick={() => handleQuickRangeSelect('quarter')}
                        >
                            Квартал
                        </Button>
                        <Button
                            size="small"
                            variant={activeQuickRange === 'all' ? 'contained' : 'outlined'}
                            onClick={() => handleQuickRangeSelect('all')}
                        >
                            Весь период
                        </Button>

                    </Box>
                )}
            </Collapse>
        </Box>
    );
};

export default LogHistogram;
