import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
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
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ViewModeEnum } from '../constants/ViewModeEnum';
import AnomalySettingsDialog from './AnomalySettingsDialog';
import { LogFiltersBar } from './LogFiltersBar';
import type { LogFilters } from '../types/filters';
import type { LogFormatField } from '../utils/logFormatDetector';

const LOG_TABLE_SEARCH_INPUT_ID = 'log-table-search-input';

type AnomalySourceRow = {
    lineNumber: number;
    raw: string;
};

interface LogToolbarProps {
    onManualRefresh: () => void;
    autoRefresh: boolean;
    onToggleAutoRefresh: () => void;
    onUploadToServer?: () => void;
    viewMode: ViewModeEnum;
    onViewModeChange: (mode: ViewModeEnum) => void;
    searchTerm: string;
    onSearchTermChange: (value: string) => void;
    onSearchSubmit?: (value: string) => boolean | Promise<boolean>;
    onNavigateToPreviousSearchMatch?: () => void;
    canNavigateToPreviousSearchMatch?: boolean;
    onNavigateToNextSearchMatch?: () => void;
    canNavigateToNextSearchMatch?: boolean;
    filters: LogFilters;
    onFiltersChange: (filters: LogFilters) => void;
    fieldDefinitions: LogFormatField[];
    hasAnomalyResults: boolean;
    isLargeFile: boolean;
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
    anomalyStorageKey?: string;
    showUploadToServer?: boolean;
    uploadInProgress?: boolean;
    uploadProgress?: number;
    fileActionsDisabled?: boolean;
    uploadDisabledReason?: string;
    refreshDisabledReason?: string;
}

const LogToolbar: React.FC<LogToolbarProps> = ({
    onManualRefresh,
    autoRefresh,
    onToggleAutoRefresh,
    onUploadToServer,
    viewMode,
    onViewModeChange,
    searchTerm,
    onSearchTermChange,
    onSearchSubmit,
    onNavigateToPreviousSearchMatch,
    canNavigateToPreviousSearchMatch = false,
    onNavigateToNextSearchMatch,
    canNavigateToNextSearchMatch = false,
    filters,
    onFiltersChange,
    fieldDefinitions,
    hasAnomalyResults,
    isLargeFile,
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
    anomalyStorageKey,
    showUploadToServer = false,
    uploadInProgress = false,
    uploadProgress = 0,
    fileActionsDisabled = false,
    uploadDisabledReason,
    refreshDisabledReason,
}) => {
    const [isAnomalySettingsPanelOpen, setIsAnomalySettingsPanelOpen] = useState<boolean>(false);
    const [searchAnchorEl, setSearchAnchorEl] = useState<HTMLElement | null>(null);
    const [filtersAnchorEl, setFiltersAnchorEl] = useState<HTMLElement | null>(null);
    const [searchDraft, setSearchDraft] = useState<string>(searchTerm);
    const [searchNotFound, setSearchNotFound] = useState(false);
    const searchButtonRef = useRef<HTMLButtonElement | null>(null);
    const filtersButtonRef = useRef<HTMLButtonElement | null>(null);

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

    const isSearchOpen = Boolean(searchAnchorEl);
    const isFiltersOpen = Boolean(filtersAnchorEl);
    const controlsDisabled = fileActionsDisabled || uploadInProgress;
    const refreshControlsDisabled = controlsDisabled || Boolean(refreshDisabledReason);

    const focusSearchInput = useCallback(() => {
        window.requestAnimationFrame(() => {
            const input = document.getElementById(LOG_TABLE_SEARCH_INPUT_ID) as HTMLInputElement | null;
            if (!input) {
                return;
            }

            input.focus();
            input.select();
        });
    }, []);

    const openSearchPopover = useCallback((anchor?: HTMLElement | null) => {
        if (controlsDisabled) {
            return;
        }

        const nextAnchor = anchor ?? searchButtonRef.current;
        if (!nextAnchor) {
            return;
        }

        setSearchDraft(searchTerm);
        setSearchNotFound(false);
        setSearchAnchorEl(nextAnchor);
        focusSearchInput();
    }, [controlsDisabled, focusSearchInput, searchTerm]);

    const applySearchDraft = useCallback(async () => {
        const normalized = searchDraft.trim();

        if (onSearchSubmit) {
            const hasMatches = await Promise.resolve(onSearchSubmit(searchDraft));
            if (hasMatches) {
                setSearchNotFound(false);
                setSearchAnchorEl(null);
                return;
            }

            setSearchNotFound(normalized.length > 0);
            focusSearchInput();
            return;
        }

        onSearchTermChange(searchDraft);
        setSearchNotFound(false);
        focusSearchInput();
    }, [focusSearchInput, onSearchSubmit, onSearchTermChange, searchDraft]);

    const handleSearchInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') {
            return;
        }

        event.preventDefault();
        void applySearchDraft();
    }, [applySearchDraft]);

    const clearSearch = useCallback(() => {
        setSearchDraft('');
        onSearchTermChange('');
        setSearchNotFound(false);
        focusSearchInput();
    }, [focusSearchInput, onSearchTermChange]);

    const openFiltersPopover = useCallback((anchor?: HTMLElement | null) => {
        if (filtersDisabled || controlsDisabled) {
            return;
        }

        const nextAnchor = anchor ?? filtersButtonRef.current;
        if (!nextAnchor) {
            return;
        }

        setFiltersAnchorEl(nextAnchor);
    }, [controlsDisabled, filtersDisabled]);

    useEffect(() => {
        if (!controlsDisabled) return;
        setSearchAnchorEl(null);
    }, [controlsDisabled]);

    useEffect(() => {
        if (!filtersDisabled) return;
        setFiltersAnchorEl(null);
    }, [filtersDisabled]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }

            if (event.key.toLowerCase() !== 'f') {
                return;
            }

            event.preventDefault();
            openSearchPopover();
        };

        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [openSearchPopover]);

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
                                            disabled={uploadInProgress || filtersDisabled || !onUploadToServer || Boolean(uploadDisabledReason)}
                                            sx={{
                                                ...compactButtonSx,
                                                minHeight: 24,
                                                px: 1,
                                            }}
                                        >
                                            {uploadInProgress ? `Идет загрузка ${uploadProgress}%` : 'Загрузить на сервер'}
                                        </Button>
                                    </span>
                                </Box>
                            </Tooltip>
                            {uploadDisabledReason && !uploadInProgress && (
                                <Typography
                                    variant="caption"
                                    color="warning.main"
                                >
                                    {uploadDisabledReason}
                                </Typography>
                            )}
                        </Box>

                        <Divider
                            orientation="vertical"
                            flexItem
                        />
                    </>
                )}

                {!isLargeFile && (
                    <>
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
                                    title={refreshDisabledReason || 'Refresh now'}
                                    arrow
                                >
                                    <span>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            onClick={onManualRefresh}
                                            disabled={refreshControlsDisabled}
                                            startIcon={<RefreshIcon fontSize="small" />}
                                            sx={compactButtonSx}
                                        >
                                            Обновить
                                        </Button>
                                    </span>
                                </Tooltip>

                                <Tooltip
                                    title={refreshDisabledReason || (autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off')}
                                    arrow
                                >
                                    <span>
                                        <Button
                                            size="small"
                                            variant={autoRefresh ? 'contained' : 'outlined'}
                                            color={autoRefresh ? 'success' : 'inherit'}
                                            onClick={onToggleAutoRefresh}
                                            disabled={refreshControlsDisabled}
                                            startIcon={<AutorenewIcon fontSize="small" />}
                                            sx={compactButtonSx}
                                        >
                                            Авто
                                        </Button>
                                    </span>
                                </Tooltip>
                            </Box>
                        </Box>

                        <Divider
                            orientation="vertical"
                            flexItem
                        />
                    </>
                )}

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

                <Box
                    sx={{
                        ml: 'auto',
                        display: 'flex',
                        alignSelf: 'stretch',
                        alignItems: 'center',
                        gap: 1,
                    }}
                >
                    <Tooltip
                        title="Поиск (Ctrl+F)"
                        arrow
                    >
                        <span>
                            <IconButton
                                ref={searchButtonRef}
                                size="small"
                                onClick={(event) => openSearchPopover(event.currentTarget)}
                                disabled={controlsDisabled}
                                color={isSearchOpen || searchTerm.trim().length > 0 ? 'primary' : 'default'}
                                sx={{ p: 0.5 }}
                            >
                                <SearchIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <Tooltip
                        title="Предыдущее совпадение"
                        arrow
                    >
                        <span>
                            <IconButton
                                size="small"
                                onClick={onNavigateToPreviousSearchMatch}
                                disabled={controlsDisabled || !canNavigateToPreviousSearchMatch || !onNavigateToPreviousSearchMatch}
                                color={canNavigateToPreviousSearchMatch ? 'primary' : 'default'}
                                sx={{ p: 0.5 }}
                            >
                                <KeyboardArrowUpIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <Tooltip
                        title="Следующее совпадение"
                        arrow
                    >
                        <span>
                            <IconButton
                                size="small"
                                onClick={onNavigateToNextSearchMatch}
                                disabled={controlsDisabled || !canNavigateToNextSearchMatch || !onNavigateToNextSearchMatch}
                                color={canNavigateToNextSearchMatch ? 'primary' : 'default'}
                                sx={{ p: 0.5 }}
                            >
                                <KeyboardArrowDownIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <Divider
                        orientation="vertical"
                        flexItem
                    />

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
                                    ref={filtersButtonRef}
                                    size="small"
                                    variant='outlined'
                                    onClick={(event) => openFiltersPopover(event.currentTarget)}
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
                open={isSearchOpen}
                anchorEl={searchAnchorEl}
                onClose={() => {
                    setSearchAnchorEl(null);
                    setSearchNotFound(false);
                }}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <Box sx={{ p: 1.5, width: 380 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <TextField
                            id={LOG_TABLE_SEARCH_INPUT_ID}
                            label="Поиск по таблице"
                            value={searchDraft}
                            onChange={(event) => {
                                setSearchDraft(event.target.value);
                                setSearchNotFound(false);
                            }}
                            onKeyDown={handleSearchInputKeyDown}
                            placeholder="Введите слово или фразу"
                            size="small"
                            autoFocus
                            InputProps={{
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            size="small"
                                            onClick={clearSearch}
                                            disabled={searchDraft.length === 0 && searchTerm.length === 0}
                                            edge="end"
                                            aria-label="Очистить поиск"
                                        >
                                            <CloseIcon fontSize="small" />
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                            fullWidth
                        />
                        <Button
                            size="small"
                            variant="contained"
                            onClick={() => {
                                void applySearchDraft();
                            }}
                            sx={{ minWidth: 86, height: 40 }}
                        >
                            Найти
                        </Button>
                    </Box>
                    {searchNotFound && (
                        <Alert
                            severity="warning"
                            variant="outlined"
                            icon={<WarningAmberOutlinedIcon fontSize="inherit" />}
                            sx={{
                                mt: 0.75,
                                py: 0.25,
                                borderRadius: 1,
                                borderColor: 'warning.main',
                                backgroundColor: 'rgba(255, 167, 38, 0.08)',
                                color: 'warning.dark',
                                '& .MuiAlert-icon': {
                                    color: 'warning.main',
                                    alignItems: 'center',
                                },
                            }}
                        >
                            Совпадений не найдено
                        </Alert>
                    )}
                </Box>
            </Popover>

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
                anomalyStorageKey={anomalyStorageKey}
            />
        </>
    );
};

export default LogToolbar;
