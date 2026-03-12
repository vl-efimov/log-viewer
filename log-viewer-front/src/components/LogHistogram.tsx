import React, { useMemo, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import Slider from '@mui/material/Slider';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { BarChart } from '@mui/x-charts/BarChart';
import { axisClasses } from '@mui/x-charts/ChartsAxis';
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
    const [sliderRange, setSliderRange] = useState<[number, number]>([0, 100]);
    
    // Process parsed lines into histogram data
    const { chartData, logLevels, bucketSize, timeRange } = useMemo(() => {
        // Extract lines with valid timestamps and levels
        const validLines = parsedLines.filter(line => {
            if (!line.parsed?.fields?.timestamp) return false;
            return parseTimestamp(line.parsed.fields.timestamp) !== null;
        });
        
        if (validLines.length === 0) {
            return { chartData: [], logLevels: [], bucketSize: 60000, timeRange: null };
        }
        
        // Get all timestamps
        const timestamps = validLines.map(line => {
            const ts = parseTimestamp(line.parsed!.fields.timestamp);
            return ts!.getTime();
        });
        
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);
        const bucketSize = calculateBucketSize(minTime, maxTime);
        
        // Create buckets
        const buckets: Map<number, Record<string, number>> = new Map();
        const levelSet = new Set<string>();
        
        validLines.forEach(line => {
            const ts = parseTimestamp(line.parsed!.fields.timestamp)!.getTime();
            const bucketKey = Math.floor(ts / bucketSize) * bucketSize;
            const level = (line.parsed!.fields.level || 'UNKNOWN').toUpperCase();
            
            levelSet.add(level);
            
            if (!buckets.has(bucketKey)) {
                buckets.set(bucketKey, {});
            }
            const bucket = buckets.get(bucketKey)!;
            bucket[level] = (bucket[level] || 0) + 1;
        });
        
        // Sort levels by priority (errors on top)
        const logLevels = Array.from(levelSet).sort((a, b) => {
            const priorityA = LOG_LEVEL_PRIORITY[a] || 0;
            const priorityB = LOG_LEVEL_PRIORITY[b] || 0;
            return priorityA - priorityB; // Lower priority at bottom of stack
        });
        
        // Convert to chart data format
        const chartData: HistogramDataPoint[] = Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([timestamp, levels]) => ({
                time: formatTimeLabel(timestamp, bucketSize),
                timestamp,
                ...levels,
            }));
        
        return {
            chartData,
            logLevels,
            bucketSize,
            timeRange: { min: minTime, max: maxTime },
        };
    }, [parsedLines]);
    
    // Calculate visible data based on slider range
    const visibleChartData = useMemo(() => {
        if (chartData.length === 0) return [];
        const startIdx = Math.floor((sliderRange[0] / 100) * chartData.length);
        const endIdx = Math.ceil((sliderRange[1] / 100) * chartData.length);
        return chartData.slice(startIdx, Math.max(endIdx, startIdx + 1));
    }, [chartData, sliderRange]);
    
    // Prepare series for MUI X Charts
    const series = useMemo(() => {
        return logLevels.map(level => ({
            dataKey: level,
            label: level,
            stack: 'total',
            color: LOG_LEVEL_COLORS[level] || LOG_LEVEL_COLORS['UNKNOWN'],
        }));
    }, [logLevels]);
    
    // Handle slider change
    const handleSliderChange = useCallback((_event: Event, newValue: number | number[]) => {
        const range = newValue as [number, number];
        setSliderRange(range);
    }, []);
    
    // Notify parent when slider is committed
    const handleSliderChangeCommitted = useCallback((_event: React.SyntheticEvent | Event, newValue: number | number[]) => {
        if (!onTimeRangeChange || !timeRange || chartData.length === 0) return;
        
        const range = newValue as [number, number];
        const startIdx = Math.floor((range[0] / 100) * chartData.length);
        const endIdx = Math.ceil((range[1] / 100) * chartData.length);
        
        if (range[0] === 0 && range[1] === 100) {
            // Full range - clear filter
            onTimeRangeChange(null, null);
        } else {
            const startTime = chartData[startIdx]?.timestamp ?? timeRange.min;
            const endTime = chartData[Math.min(endIdx, chartData.length - 1)]?.timestamp ?? timeRange.max;
            onTimeRangeChange(startTime, endTime + bucketSize);
        }
    }, [onTimeRangeChange, timeRange, chartData, bucketSize]);
    
    // Format slider value labels
    const formatSliderLabel = useCallback((value: number) => {
        if (chartData.length === 0) return '';
        const idx = Math.floor((value / 100) * chartData.length);
        const safeIdx = Math.min(idx, chartData.length - 1);
        return chartData[safeIdx]?.time ?? '';
    }, [chartData]);
    
    // Don't render if no valid data
    if (chartData.length === 0) {
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
                        ({visibleChartData.length}/{chartData.length} intervals, {formatBucketSize(bucketSize)} each)
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
                    <BarChart
                        dataset={visibleChartData}
                        xAxis={[{ 
                            scaleType: 'band', 
                            dataKey: 'time',
                            tickLabelStyle: { fontSize: 10 },
                        }]}
                        yAxis={[{ 
                            tickLabelStyle: { fontSize: 10 },
                        }]}
                        series={series}
                        height={height}
                        margin={{ top: 20, right: 20, left: 40, bottom: 30 }}
                        slotProps={{
                            legend: {
                                direction: 'horizontal' as const,
                                position: { vertical: 'top' as const, horizontal: 'center' as const },
                            },
                        }}
                        sx={{
                            [`& .${axisClasses.root}`]: {
                                [`& .${axisClasses.tick}, & .${axisClasses.line}`]: {
                                    stroke: (theme) => theme.palette.text.secondary,
                                },
                                [`& .${axisClasses.tickLabel}`]: {
                                    fill: (theme) => theme.palette.text.secondary,
                                },
                            },
                        }}
                    />
                    
                    {/* Range slider */}
                    <Box sx={{ px: 2, pt: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                            Time Range Filter
                        </Typography>
                        <Slider
                            value={sliderRange}
                            onChange={handleSliderChange}
                            onChangeCommitted={handleSliderChangeCommitted}
                            valueLabelDisplay="auto"
                            valueLabelFormat={formatSliderLabel}
                            min={0}
                            max={100}
                            size="small"
                            sx={{
                                '& .MuiSlider-valueLabel': {
                                    fontSize: 10,
                                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                },
                            }}
                        />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="text.secondary">
                                {chartData[0]?.time}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {chartData[chartData.length - 1]?.time}
                            </Typography>
                        </Box>
                    </Box>
                </Box>
            </Collapse>
        </Box>
    );
};

export default LogHistogram;
