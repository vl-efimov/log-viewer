import { useEffect, useMemo, useState } from 'react';
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
import { getFileHandle, getFileObject } from '../redux/slices/logFileSlice';
import { getDashboardSnapshot } from '../utils/logIndexedDb';
import {
    countFileLines,
    sampleAndAnalyzeLargeFile,
    type HistogramLine,
    type LargeFileAggregateStats,
} from '../utils/histogramSampling';

const MAX_CATEGORY_VALUES = 8;
const MAX_LARGE_FILE_CACHE_ENTRIES = 3;
const MAX_NORMAL_DASHBOARD_CACHE_ENTRIES = 5;
const PRIORITY_FIELDS = ['level', 'status', 'method', 'queue', 'type', 'component', 'host', 'user', 'class', 'ip'];
const CORE_CHART_FIELDS = ['level', 'status', 'method'];

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
    facets: Facet[];
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
    return new Map(
        Object.entries(record).map(([field, values]) => [
            field,
            new Map(Object.entries(values)),
        ])
    );
};

const toChartOption = (
    title: string,
    values: Array<{ label: string; count: number }>,
    locale: string
) => {
    return {
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
    } = useSelector((state: RootState) => state.logFile);
    const [isHistogramLoading, setIsHistogramLoading] = useState<boolean>(false);
    const [histogramProgress, setHistogramProgress] = useState<number>(0);
    const [largeFileHistogramLines, setLargeFileHistogramLines] = useState<HistogramLine[]>([]);
    const [largeFileStats, setLargeFileStats] = useState<LargeFileAggregateStats | null>(null);
    const [normalSnapshot, setNormalSnapshot] = useState<NormalDashboardSnapshot | null>(null);
    const [isNormalSnapshotLoading, setIsNormalSnapshotLoading] = useState<boolean>(false);
    const isRemoteLargeSession = isLargeFile && analyticsSessionId.startsWith('remote:');
    const useLocalLargeMode = isLargeFile && !isRemoteLargeSession;
    const largeFileCacheKey = useMemo(() => {
        return getLargeFileDashboardCacheKey(analyticsSessionId, fileName, fileSize, lastModified);
    }, [analyticsSessionId, fileName, fileSize, lastModified]);
    const normalFileCacheKey = useMemo(() => {
        return `${analyticsSessionId}|${fileName}|${fileSize}|${lastModified}`;
    }, [analyticsSessionId, fileName, fileSize, lastModified]);

    const analytics = useMemo(() => {
        const toSortedValues = (counter?: Map<string, number>) => {
            if (!counter) {
                return [];
            }

            return Array.from(counter.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, MAX_CATEGORY_VALUES)
                .map(([label, count]) => ({ label: shortLabel(label), count }));
        };

        const buildFacets = (fieldValueCounters: Map<string, Map<string, number>>): Facet[] => {
            const preferredFacetFields = PRIORITY_FIELDS.filter((field) => {
                const counter = fieldValueCounters.get(field);
                return Boolean(counter && counter.size > 1 && !CORE_CHART_FIELDS.includes(field));
            });

            const fallbackFacetFields = Array.from(fieldValueCounters.entries())
                .filter(([field, counter]) => {
                    return counter.size > 1
                        && !preferredFacetFields.includes(field)
                        && !CORE_CHART_FIELDS.includes(field);
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
                    values: toSortedValues(values),
                };
            });
        };

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
                levelValues: toSortedValues(fieldValueCounters.get('level')),
                statusValues: toSortedValues(fieldValueCounters.get('status')),
                methodValues: toSortedValues(fieldValueCounters.get('method')),
                facets: buildFacets(fieldValueCounters),
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
                const normalized = normalizeFieldValue(value);
                if (!normalized) {
                    return;
                }

                if (!fieldValueCounters.has(field)) {
                    fieldValueCounters.set(field, new Map<string, number>());
                }
                const fieldCounter = fieldValueCounters.get(field)!;
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
            levelValues: toSortedValues(fieldValueCounters.get('level')),
            statusValues: toSortedValues(fieldValueCounters.get('status')),
            methodValues: toSortedValues(fieldValueCounters.get('method')),
            facets: buildFacets(fieldValueCounters),
        };
        setNormalDashboardCache(normalFileCacheKey, snapshot);
        return snapshot;
    }, [content, largeFileHistogramLines, largeFileStats, normalFileCacheKey, normalSnapshot, useLocalLargeMode]);

    useEffect(() => {
        if (useLocalLargeMode || !analyticsSessionId) {
            setNormalSnapshot(null);
            setIsNormalSnapshotLoading(false);
            return;
        }

        let cancelled = false;

        const loadSnapshot = async () => {
            setIsNormalSnapshotLoading(true);
            try {
                const snapshot = await getDashboardSnapshot(analyticsSessionId);
                if (cancelled) return;
                if (snapshot) {
                    const fieldValueCounters = toFieldCounterMap(snapshot.stats.fieldValueCounts);
                    const toSortedValues = (counter?: Map<string, number>) => {
                        if (!counter) {
                            return [];
                        }

                        return Array.from(counter.entries())
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, MAX_CATEGORY_VALUES)
                            .map(([label, count]) => ({ label: shortLabel(label), count }));
                    };

                    const buildFacets = (fieldCounters: Map<string, Map<string, number>>): Facet[] => {
                        const preferredFacetFields = PRIORITY_FIELDS.filter((field) => {
                            const counter = fieldCounters.get(field);
                            return Boolean(counter && counter.size > 1 && !CORE_CHART_FIELDS.includes(field));
                        });

                        const fallbackFacetFields = Array.from(fieldCounters.entries())
                            .filter(([field, counter]) => {
                                return counter.size > 1
                                    && !preferredFacetFields.includes(field)
                                    && !CORE_CHART_FIELDS.includes(field);
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
                            const values = fieldCounters.get(field);
                            return {
                                field,
                                values: toSortedValues(values),
                            };
                        });
                    };

                    const snapshotData: NormalDashboardSnapshot = {
                        totalLines: snapshot.stats.totalLines,
                        analyzedLines: snapshot.stats.totalLines,
                        nonEmptyLines: snapshot.stats.nonEmptyLines,
                        parsedLines: snapshot.stats.parsedLines,
                        unparsedLines: Math.max(snapshot.stats.nonEmptyLines - snapshot.stats.parsedLines, 0),
                        parseRate: snapshot.stats.nonEmptyLines > 0
                            ? Math.round((snapshot.stats.parsedLines / snapshot.stats.nonEmptyLines) * 100)
                            : 0,
                        parsedRows: snapshot.sampledLines,
                        levelValues: toSortedValues(fieldValueCounters.get('level')),
                        statusValues: toSortedValues(fieldValueCounters.get('status')),
                        methodValues: toSortedValues(fieldValueCounters.get('method')),
                        facets: buildFacets(fieldValueCounters),
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
    }, [analyticsSessionId, useLocalLargeMode]);

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
        return useLocalLargeMode ? largeFileHistogramLines : analytics.parsedRows;
    }, [analytics.parsedRows, largeFileHistogramLines, useLocalLargeMode]);

    const isLargeScanPending = useLocalLargeMode && !largeFileStats;

    if (!isMonitoring && !loaded) {
        return (
            <NoFileSelected
                title={t('dashboard.title')}
                description={t('dashboard.selectFileDescription')}
            />
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
                                    <Typography variant="h4">{analytics.totalLines.toLocaleString(locale)}</Typography>
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
                                    <Typography variant="h4">{analytics.parsedLines.toLocaleString(locale)}</Typography>
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
                                    <Typography variant="h4">{analytics.unparsedLines.toLocaleString(locale)}</Typography>
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
                                    <Typography variant="h4">{analytics.parseRate}%</Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                )}

                {!isLargeScanPending && analytics.parsedLines === 0 && (
                    <Alert severity="warning">
                        {t('dashboard.noParsedWarning')}
                    </Alert>
                )}

                {!isLargeScanPending && analytics.parsedLines > 0 && (
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
                                    <LogHistogram parsedLines={histogramSourceLines} />
                                )}
                            </CardContent>
                        </Card>

                        <Grid
                            container
                            spacing={2}
                        >
                            {analytics.levelValues.length > 0 && (
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <Card>
                                        <CardContent>
                                            <ReactECharts
                                                option={toChartOption(t('dashboard.charts.levels'), analytics.levelValues, locale)}
                                                style={{ height: 260 }}
                                            />
                                        </CardContent>
                                    </Card>
                                </Grid>
                            )}
                            {analytics.statusValues.length > 0 && (
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <Card>
                                        <CardContent>
                                            <ReactECharts
                                                option={toChartOption(t('dashboard.charts.httpStatus'), analytics.statusValues, locale)}
                                                style={{ height: 260 }}
                                            />
                                        </CardContent>
                                    </Card>
                                </Grid>
                            )}
                            {analytics.methodValues.length > 0 && (
                                <Grid size={{ xs: 12, md: 4 }}>
                                    <Card>
                                        <CardContent>
                                            <ReactECharts
                                                option={toChartOption(t('dashboard.charts.httpMethods'), analytics.methodValues, locale)}
                                                style={{ height: 260 }}
                                            />
                                        </CardContent>
                                    </Card>
                                </Grid>
                            )}
                        </Grid>

                        {analytics.facets.length > 0 && (
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
                                        {analytics.facets.map((facet) => (
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
                        )}
                    </>
                )}
            </Stack>
        </Box>
    );
};

export default DashboardPage;
