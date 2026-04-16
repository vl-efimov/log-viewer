import Box from '@mui/material/Box';
import Badge from '@mui/material/Badge';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import NotificationsIcon from '@mui/icons-material/Notifications';
import CloseIcon from '@mui/icons-material/Close';
import { useEffect, useState } from 'react';
import { ViewModeEnum } from '../constants/ViewModeEnum';
import AnomalySettingsDialog from './AnomalySettingsDialog';
import { LogFiltersBar } from './LogFiltersBar';
import type { LogFilters } from '../types/filters';
import type { LogFormatField } from '../utils/logFormatDetector';

type AnomalySourceRow = {
    lineNumber: number;
    raw: string;
};

interface LogToolbarProps {
    onManualRefresh: () => void;
    autoRefresh: boolean;
    onToggleAutoRefresh: () => void;
    onUploadToServer?: () => void;
    onCancelUploadToServer?: () => void;
    viewMode: ViewModeEnum;
    onViewModeChange: (mode: ViewModeEnum) => void;
    newLinesCount: number;
    filters: LogFilters;
    onFiltersChange: (filters: LogFilters) => void;
    fieldDefinitions: LogFormatField[];
    hasAnomalyResults: boolean;
    isStreamView: boolean;
    filtersDisabled: boolean;
    totalRowsHintForAnomaly: number;
    normalRows: AnomalySourceRow[];
    requestFileForAnomalyAnalysis: () => Promise<File | null>;
    onNavigateToPreviousAnomaly?: () => void;
    onNavigateToNextAnomaly?: () => void;
    canNavigateToPreviousAnomaly?: boolean;
    canNavigateToNextAnomaly?: boolean;
    remoteIngestId?: string;
    showUploadToServer?: boolean;
    uploadInProgress?: boolean;
    uploadProgress?: number;
    fileActionsDisabled?: boolean;
}

const LogToolbar: React.FC<LogToolbarProps> = ({
    onManualRefresh,
    autoRefresh,
    onToggleAutoRefresh,
    onUploadToServer,
    onCancelUploadToServer,
    viewMode,
    onViewModeChange,
    newLinesCount,
    filters,
    onFiltersChange,
    fieldDefinitions,
    hasAnomalyResults,
    isStreamView,
    filtersDisabled,
    totalRowsHintForAnomaly,
    normalRows,
    requestFileForAnomalyAnalysis,
    onNavigateToPreviousAnomaly,
    onNavigateToNextAnomaly,
    canNavigateToPreviousAnomaly = false,
    canNavigateToNextAnomaly = false,
    remoteIngestId,
    showUploadToServer = false,
    uploadInProgress = false,
    uploadProgress = 0,
    fileActionsDisabled = false,
}) => {
    const [isAnomalySettingsPanelOpen, setIsAnomalySettingsPanelOpen] = useState<boolean>(false);
    const [filtersAnchorEl, setFiltersAnchorEl] = useState<HTMLElement | null>(null);

    const compactButtonSx = {
        minWidth: 0,
        px: 0.75,
        py: 0.25,
        textTransform: 'none' as const,
        fontSize: '0.75rem',
        lineHeight: 1,
        '& .MuiButton-startIcon': {
            marginRight: 0.5,
            marginLeft: 0,
        },
    };

    const activeFiltersCount = Object.keys(filters).filter((key) => {
        const value = filters[key];
        if (!value) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object' && 'value' in value) return Boolean(value.value);
        if (typeof value === 'object' && ('start' in value || 'end' in value)) {
            return Boolean(value.start || value.end);
        }
        return false;
    }).length;

    const isFiltersOpen = Boolean(filtersAnchorEl) && !filtersDisabled;
    const controlsDisabled = fileActionsDisabled || uploadInProgress;

    useEffect(() => {
        if (!filtersDisabled) return;
        setFiltersAnchorEl(null);
    }, [filtersDisabled]);

    return (
        <>
            <Paper
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    mb: 1,
                    px: 1.5,
                    py: 0.5,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                }}
                elevation={0}
            >
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.25
                    }}
                >
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                    >
                        Порядок
                    </Typography>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            px: 0.5,
                            py: 0.25,
                        }}
                    >
                        <Tooltip
                            title="С начала"
                            arrow
                        >
                            <Button
                                size="small"
                                variant={viewMode === ViewModeEnum.FromStart ? 'contained' : 'outlined'}
                                onClick={() => onViewModeChange(ViewModeEnum.FromStart)}
                                startIcon={<VerticalAlignBottomIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                С начала
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title="С конца"
                            arrow
                        >
                            <Button
                                size="small"
                                variant={viewMode === ViewModeEnum.FromEnd ? 'contained' : 'outlined'}
                                onClick={() => onViewModeChange(ViewModeEnum.FromEnd)}
                                startIcon={<VerticalAlignTopIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                С конца
                            </Button>
                        </Tooltip>
                    </Box>
                </Box>

                <Divider
                    orientation="vertical"
                    flexItem
                />

                {showUploadToServer && (
                    <>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                            <Typography
                                variant="caption"
                                sx={{ color: 'text.secondary' }}
                            >
                                Сервер
                            </Typography>
                            <Tooltip
                                title={uploadInProgress
                                    ? `Загрузка на сервер: ${uploadProgress}%`
                                    : 'Загрузить файл на сервер'
                                }
                                arrow
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <span>
                                        <Button
                                            size="small"
                                            variant="contained"
                                            onClick={onUploadToServer}
                                            disabled={uploadInProgress || filtersDisabled || !onUploadToServer}
                                            sx={compactButtonSx}
                                        >
                                            {uploadInProgress ? `Идет загрузка ${uploadProgress}%` : 'Загрузить на сервер'}
                                        </Button>
                                    </span>

                                    {uploadInProgress && onCancelUploadToServer && (
                                        <Tooltip
                                            title="Отменить загрузку"
                                            arrow
                                        >
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={onCancelUploadToServer}
                                                sx={{ p: 0.5 }}
                                            >
                                                <CloseIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </Box>
                            </Tooltip>
                        </Box>

                        <Divider
                            orientation="vertical"
                            flexItem
                        />
                    </>
                )}

                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.25
                    }}
                >
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                    >
                        Обновление
                    </Typography>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1
                        }}
                    >
                        <Tooltip
                            title="Refresh now"
                            arrow
                        >
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={onManualRefresh}
                                disabled={controlsDisabled}
                                startIcon={<RefreshIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                Обновить
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
                            arrow
                        >
                            <Button
                                size="small"
                                variant={autoRefresh ? 'contained' : 'outlined'}
                                color={autoRefresh ? 'success' : 'inherit'}
                                onClick={onToggleAutoRefresh}
                                disabled={controlsDisabled}
                                startIcon={<AutorenewIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                Авто
                            </Button>
                        </Tooltip>
                    </Box>
                </Box>

                <Divider
                    orientation="vertical"
                    flexItem
                />

                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                    >
                        Аномалии
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Tooltip
                            title="Anomaly settings"
                            arrow
                        >
                            <Button
                                size="small"
                                variant={isAnomalySettingsPanelOpen ? 'contained' : 'outlined'}
                                onClick={() => setIsAnomalySettingsPanelOpen((prev) => !prev)}
                                disabled={controlsDisabled}
                                startIcon={<AutoAwesomeIcon fontSize="small" />}
                                sx={compactButtonSx}
                            >
                                Настройки
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title="К предыдущей аномалии"
                            arrow
                        >
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={onNavigateToPreviousAnomaly}
                                    disabled={controlsDisabled || !canNavigateToPreviousAnomaly || !onNavigateToPreviousAnomaly}
                                    sx={{ p: 0.5 }}
                                >
                                    <KeyboardArrowUpIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>

                        <Tooltip
                            title="К следующей аномалии"
                            arrow
                        >
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={onNavigateToNextAnomaly}
                                    disabled={controlsDisabled || !canNavigateToNextAnomaly || !onNavigateToNextAnomaly}
                                    sx={{ p: 0.5 }}
                                >
                                    <KeyboardArrowDownIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>

                <Divider
                    orientation="vertical"
                    flexItem
                />

                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                    >
                        Уведомления
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Tooltip
                            title={`${newLinesCount} new lines`}
                            arrow
                        >
                            <span>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    disabled={controlsDisabled || newLinesCount === 0}
                                    startIcon={(
                                        <Badge
                                            badgeContent={newLinesCount}
                                            color="success"
                                            max={999}
                                            invisible={newLinesCount === 0}
                                        >
                                            <NotificationsIcon fontSize="small" />
                                        </Badge>
                                    )}
                                    sx={compactButtonSx}
                                >
                                    Новые
                                </Button>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>

                <Box
                    sx={{
                        ml: 'auto',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                        <Tooltip
                            title={filtersDisabled ? 'Filters disabled while indexing' : 'Filters'}
                            arrow
                        >
                            <Badge
                                color="secondary"
                                badgeContent={activeFiltersCount}
                                invisible={activeFiltersCount === 0}
                            >
                                <Button
                                    size="small"
                                    variant='outlined'
                                    onClick={(event) => setFiltersAnchorEl(event.currentTarget)}
                                    disabled={filtersDisabled || controlsDisabled}
                                    startIcon={(
                                        <FilterAltIcon fontSize="small" />
                                    )}
                                    sx={compactButtonSx}
                                >
                                    Фильтры
                                </Button>
                            </Badge>

                        </Tooltip>
                    </Box>
                </Box>
            </Paper >

            <Popover
                open={isFiltersOpen}
                anchorEl={filtersAnchorEl}
                onClose={() => setFiltersAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <LogFiltersBar
                    filters={filters}
                    onFiltersChange={onFiltersChange}
                    fieldDefinitions={fieldDefinitions}
                    anomalyFilterEnabled={hasAnomalyResults}
                    onCloseRequested={() => setFiltersAnchorEl(null)}
                />
            </Popover>

            <AnomalySettingsDialog
                open={isAnomalySettingsPanelOpen}
                onClose={() => setIsAnomalySettingsPanelOpen(false)}
                isStreamView={isStreamView}
                totalRowsHint={totalRowsHintForAnomaly}
                normalRows={normalRows}
                requestFileForAnomalyAnalysis={requestFileForAnomalyAnalysis}
                remoteIngestId={remoteIngestId}
            />
        </>
    );
};

export default LogToolbar;
