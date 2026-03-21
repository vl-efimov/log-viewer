import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ReactECharts from 'echarts-for-react';
import type { ParsedLogLine } from '../utils/logFormatDetector';

// Log level colors - consistent across different log formats
const LOG_LEVEL_COLORS: Record<string, string> = {
    // Error levels
    'FATAL': '#d32f2f',
    'fatal': '#d32f2f',
    'CRITICAL': '#d32f2f',
    'critical': '#d32f2f',
    'ERROR': '#f44336',
    'error': '#f44336',
    'err': '#f44336',
    'SEVERE': '#f44336',
    'severe': '#f44336',
    
    // Warning levels
    'WARN': '#ff9800',
    'warn': '#ff9800',
    'WARNING': '#ff9800',
    'warning': '#ff9800',
    'NOTICE': '#ffc107',
    'notice': '#ffc107',
    
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
}

/**
 * Parses various timestamp formats to a Date object
 */
function parseTimestamp(timestamp: string): Date | null {
    if (!timestamp) return null;
    
    // Try direct Date parsing first
    const directParse = new Date(timestamp);
    if (!isNaN(directParse.getTime())) {
        return directParse;
    }
    
    // Try common formats
    // Format: YYYY-MM-DD HH:MM:SS,mmm (HDFS style)
    const hdfsMatch = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})[,.](\d{3})?/);
    if (hdfsMatch) {
        const [, year, month, day, hour, min, sec, ms] = hdfsMatch;
        return new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hour),
            parseInt(min),
            parseInt(sec),
            parseInt(ms || '0')
        );
    }
    
    // Format: Mon Oct 30 12:34:56 2025 (Apache style)
    const apacheMatch = timestamp.match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/);
    if (apacheMatch) {
        const [, month, day, hour, min, sec, year] = apacheMatch;
        const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
        if (monthIndex >= 0) {
            return new Date(parseInt(year), monthIndex, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
        }
    }
    
    // Format: DD/Mon/YYYY:HH:MM:SS (Apache access log style)
    const accessMatch = timestamp.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
    if (accessMatch) {
        const [, day, month, year, hour, min, sec] = accessMatch;
        const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
        if (monthIndex >= 0) {
            return new Date(parseInt(year), monthIndex, parseInt(day), parseInt(hour), parseInt(min), parseInt(sec));
        }
    }
    
    return null;
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
function formatTimeLabel(timestamp: number, bucketSize: number): string {
    const date = new Date(timestamp);
    
    if (bucketSize >= 86400000) {
        // Day or larger: show date
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else if (bucketSize >= 3600000) {
        // Hour or larger: show date and hour
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } else {
        // Smaller: show time with seconds
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
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
}) => {
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
    const [selectedRange, setSelectedRange] = useState<{ start: number | null; end: number | null }>({
        start: null,
        end: null,
    });
    const [zoomShade, setZoomShade] = useState<{ leftPercent: number; rightPercent: number }>({
        leftPercent: 0,
        rightPercent: 0,
    });
    const pendingZoomRef = useRef<{
        start: number;
        end: number;
        leftPercent: number;
        rightPercent: number;
        fullRange: boolean;
    } | null>(null);
    const zoomRafRef = useRef<number | null>(null);
    
    const { validLines, timeRange } = useMemo(() => {
        // Extract lines with valid timestamps and levels
        const validLines = parsedLines.filter(line => {
            if (!line.parsed?.fields?.timestamp) return false;
            return parseTimestamp(line.parsed.fields.timestamp) !== null;
        });
        
        if (validLines.length === 0) {
            return { validLines: [], timeRange: null };
        }
        
        // Get all timestamps
        const timestamps = validLines.map(line => {
            const ts = parseTimestamp(line.parsed!.fields.timestamp);
            return ts!.getTime();
        });
        
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);
        return {
            validLines,
            timeRange: { min: minTime, max: maxTime },
        };
    }, [parsedLines]);

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
        const levelSet = new Set<string>();

        lines.forEach(line => {
            const ts = parseTimestamp(line.parsed!.fields.timestamp)!.getTime();
            if (ts < range.start || ts > range.end) return;
            const bucketKey = Math.floor(ts / bucketSize) * bucketSize;
            const level = (line.parsed!.fields.level || 'UNKNOWN').toUpperCase();

            levelSet.add(level);

            if (!buckets.has(bucketKey)) {
                buckets.set(bucketKey, {});
            }
            const bucket = buckets.get(bucketKey)!;
            bucket[level] = (bucket[level] || 0) + 1;
        });

        const logLevels = Array.from(levelSet).sort((a, b) => {
            const priorityA = LOG_LEVEL_PRIORITY[a] || 0;
            const priorityB = LOG_LEVEL_PRIORITY[b] || 0;
            return priorityA - priorityB;
        });

        const chartData: HistogramDataPoint[] = Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([timestamp, levels]) => ({
                time: formatTimeLabel(timestamp, bucketSize),
                timestamp,
                ...levels,
            }));

        return { chartData, logLevels, bucketSize };
    }, []);

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

    const zoomSliderGrid = {
        top: 6,
        right: 20,
        left: 40,
        bottom: 28,
    };

    const zoomChartGrid = {
        ...zoomSliderGrid,
        top: 18,
        bottom: 5,
    };

    useEffect(() => {
        if (!timeRange) return;
        setZoomShade({ leftPercent: 0, rightPercent: 0 });
    }, [timeRange?.min, timeRange?.max]);
    
    const chartOption = useMemo(() => {
        const timeLabels = mainHistogram.chartData.map(point => point.time);
        const series = mainHistogram.logLevels.map(level => ({
            name: level,
            type: 'bar',
            stack: 'total',
            emphasis: { focus: 'series' },
            itemStyle: { color: LOG_LEVEL_COLORS[level] || LOG_LEVEL_COLORS.UNKNOWN },
            data: mainHistogram.chartData.map(point => (typeof point[level] === 'number' ? point[level] : 0)),
        }));

        return {
            tooltip: { trigger: 'axis' },
            legend: { top: 0 },
            grid: { top: 20, right: 20, left: 40, bottom: 10 },
            xAxis: {
                type: 'category',
                data: timeLabels,
                axisLabel: { fontSize: 10 },
            },
            yAxis: {
                type: 'value',
                axisLabel: { fontSize: 10 },
            },
            series,
        };
    }, [mainHistogram]);

    const zoomChartOption = useMemo(() => {
        const totals = zoomHistogram.chartData.map(point =>
            zoomHistogram.logLevels.reduce((sum, level) => sum + (typeof point[level] === 'number' ? (point[level] as number) : 0), 0)
        );

        return {
            tooltip: { show: false },
            grid: zoomChartGrid,
            xAxis: {
                type: 'time',
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
            series: [
                {
                    type: 'line',
                    data: zoomHistogram.chartData.map((point, index) => [point.timestamp, totals[index]]),
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 1, color: '#90caf9' },
                },
            ],
        };
    }, [zoomHistogram]);

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

    const handleZoom = useCallback((params: { start?: number; end?: number; startValue?: number; endValue?: number; batch?: Array<{ start?: number; end?: number; startValue?: number; endValue?: number }> }) => {
        if (!timeRange || zoomHistogram.chartData.length === 0) return;

        const payload = params?.batch?.[0] ?? params ?? {};
        const startValue = payload.startValue ?? params.startValue;
        const endValue = payload.endValue ?? params.endValue;

        let startTime = timeRange.min;
        let endTime = timeRange.max;

        if (typeof startValue === 'number' && typeof endValue === 'number') {
            startTime = Math.max(timeRange.min, Math.floor(startValue));
            endTime = Math.min(timeRange.max, Math.ceil(endValue));
        } else {
            const startPercent = typeof payload.start === 'number' ? payload.start : (typeof params.start === 'number' ? params.start : 0);
            const endPercent = typeof payload.end === 'number' ? payload.end : (typeof params.end === 'number' ? params.end : 100);
            startTime = timeRange.min + ((timeRange.max - timeRange.min) * startPercent) / 100;
            endTime = timeRange.min + ((timeRange.max - timeRange.min) * endPercent) / 100;
        }

        const total = Math.max(1, timeRange.max - timeRange.min);
        const leftPercent = Math.max(0, Math.min(100, ((startTime - timeRange.min) / total) * 100));
        const rightPercent = Math.max(0, Math.min(100, ((timeRange.max - endTime) / total) * 100));
        const isFullRange = startTime <= timeRange.min && endTime >= timeRange.max;

        pendingZoomRef.current = {
            start: startTime,
            end: endTime,
            leftPercent,
            rightPercent,
            fullRange: isFullRange,
        };

        if (zoomRafRef.current !== null) return;

        zoomRafRef.current = requestAnimationFrame(() => {
            zoomRafRef.current = null;
            const pending = pendingZoomRef.current;
            if (!pending) return;

            if (pending.fullRange) {
                setSelectedRange({ start: null, end: null });
                setZoomShade({ leftPercent: 0, rightPercent: 0 });
                if (onTimeRangeChange) {
                    onTimeRangeChange(null, null);
                }
                return;
            }

            setZoomShade({ leftPercent: pending.leftPercent, rightPercent: pending.rightPercent });
            setSelectedRange({ start: pending.start, end: pending.end });
            if (onTimeRangeChange) {
                onTimeRangeChange(pending.start, pending.end);
            }
        });
    }, [onTimeRangeChange, timeRange, zoomHistogram]);
    
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
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                    Log Timeline
                    <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                        ({mainHistogram.chartData.length} intervals, {formatBucketSize(mainHistogram.bucketSize)} each)
                    </Typography>
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
                    }}
                >
                    <ReactECharts
                        option={chartOption}
                        style={{ height }}
                    />
                    <Box sx={{ mt: 1 }}>
                        <Box sx={{ position: 'relative' }}>
                            <ReactECharts
                                option={zoomChartOption}
                                style={{ height: 110 }}
                            />
                            <Box sx={{ position: 'absolute', inset: 0 }}>
                                <ReactECharts
                                    option={zoomSliderOption}
                                    style={{ height: '100%' }}
                                    onEvents={{ datazoom: handleZoom }}
                                />
                            </Box>
                            <Box
                                sx={{
                                    position: 'absolute',
                                    top: 14,
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
            </Collapse>
        </Box>
    );
};

export default LogHistogram;
