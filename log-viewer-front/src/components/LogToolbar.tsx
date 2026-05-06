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
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ViewModeEnum } from '@/constants/ViewModeEnum';
import AnomalySettingsDialog from '@/components/AnomalySettingsDialog';
import { LogFiltersBar } from '@/components/LogFiltersBar';
import type { LogFilters } from '@/types/filters';
import type { LogFormatField } from '@/utils/logFormatDetector';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

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

/**
 * Toolbar with search, filters, refresh, and anomaly actions.
 */
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
    const { t } = useTranslation();
    const theme = useTheme();
    const isCompactToolbar = useMediaQuery(theme.breakpoints.down('lg'));
    const [isAnomalySettingsPanelOpen, setIsAnomalySettingsPanelOpen] = useState<boolean>(false);
    const [searchAnchorEl, setSearchAnchorEl] = useState<HTMLElement | null>(null);
    const [filtersAnchorEl, setFiltersAnchorEl] = useState<HTMLElement | null>(null);
    const [searchDraft, setSearchDraft] = useState<string>(searchTerm);
    const [searchNotFound, setSearchNotFound] = useState(false);
    const searchButtonRef = useRef<HTMLButtonElement | null>(null);
    const filtersButtonRef = useRef<HTMLButtonElement | null>(null);

    const compactButtonSx = {        
        textTransform: 'none' as const,
        fontSize: '0.75rem',
        lineHeight: 1,
    };
    const iconOnlyButtonSx = {
        ...compactButtonSx,
        minWidth: 34,
        px: 0.75,
        '& .MuiButton-startIcon': {
            margin: 0,
        },
    };
    const actionButtonSx = isCompactToolbar ? iconOnlyButtonSx : compactButtonSx;
    const renderButtonLabel = (label: string) => (isCompactToolbar ? null : label);

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
    const sectionCaptionSx = {
        color: (theme: { palette: { mode: string; text: { secondary: string } } }) => (
            theme.palette.mode === 'dark' ? '#cbd5e1' : theme.palette.text.secondary
        ),
    };

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
                    gap: isCompactToolbar ? 0.75 : 1.5,
                    flexWrap: 'nowrap',
                    mb: 1,
                    px: isCompactToolbar ? 1 : 1.5,
                    py: 0.5,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    overflowX: isCompactToolbar ? 'auto' : 'visible',
                    overflowY: 'hidden',
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
                        sx={sectionCaptionSx}
                    >
                        {t('toolbar.sections.order')}
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
                            title={t('toolbar.order.fromStart')}
                            arrow
                        >
                            <Button
                                size="small"
                                variant={viewMode === ViewModeEnum.FromStart ? 'contained' : 'outlined'}
                                onClick={() => onViewModeChange(ViewModeEnum.FromStart)}
                                startIcon={<VerticalAlignBottomIcon fontSize="small" />}
                                sx={actionButtonSx}
                                aria-label={t('toolbar.order.fromStart')}
                            >
                                {renderButtonLabel(t('toolbar.order.fromStart'))}
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title={t('toolbar.order.fromEnd')}
                            arrow
                        >
                            <Button
                                size="small"
                                variant={viewMode === ViewModeEnum.FromEnd ? 'contained' : 'outlined'}
                                onClick={() => onViewModeChange(ViewModeEnum.FromEnd)}
                                startIcon={<VerticalAlignTopIcon fontSize="small" />}
                                sx={actionButtonSx}
                                aria-label={t('toolbar.order.fromEnd')}
                            >
                                {renderButtonLabel(t('toolbar.order.fromEnd'))}
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
                                sx={sectionCaptionSx}
                            >
                                {t('toolbar.sections.server')}
                            </Typography>
                            <Tooltip
                                title={uploadInProgress
                                    ? t('toolbar.server.uploadTooltipProgress', { progress: uploadProgress })
                                    : t('toolbar.server.uploadTooltip')
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
                                            startIcon={<CloudUploadIcon fontSize="small" />}
                                            sx={{
                                                ...(isCompactToolbar ? iconOnlyButtonSx : compactButtonSx),
                                                minHeight: 24,
                                                px: 1,
                                            }}
                                            aria-label={uploadInProgress
                                                ? t('toolbar.server.uploadingButton', { progress: uploadProgress })
                                                : t('toolbar.server.uploadButton')}
                                        >
                                            {isCompactToolbar ? null : (uploadInProgress
                                                ? t('toolbar.server.uploadingButton', { progress: uploadProgress })
                                                : t('toolbar.server.uploadButton'))}
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
                                sx={sectionCaptionSx}
                            >
                                {t('toolbar.sections.refresh')}
                            </Typography>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1
                                }}
                            >
                                <Tooltip
                                    title={refreshDisabledReason || t('toolbar.refresh.refreshNow')}
                                    arrow
                                    describeChild
                                >
                                    <span>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            onClick={onManualRefresh}
                                            disabled={refreshControlsDisabled}
                                            startIcon={<RefreshIcon fontSize="small" />}
                                            sx={actionButtonSx}
                                            aria-label={t('toolbar.refresh.refreshButton')}
                                        >
                                            {renderButtonLabel(t('toolbar.refresh.refreshButton'))}
                                        </Button>
                                    </span>
                                </Tooltip>

                                <Tooltip
                                    title={refreshDisabledReason || (autoRefresh ? t('toolbar.refresh.autoOn') : t('toolbar.refresh.autoOff'))}
                                    arrow
                                    describeChild
                                >
                                    <span>
                                        <Button
                                            size="small"
                                            variant={autoRefresh ? 'contained' : 'outlined'}
                                            color="primary"
                                            onClick={onToggleAutoRefresh}
                                            disabled={refreshControlsDisabled}
                                            startIcon={<AutorenewIcon fontSize="small" />}
                                            sx={actionButtonSx}
                                            aria-label={t('toolbar.refresh.autoButton')}
                                        >
                                            {renderButtonLabel(t('toolbar.refresh.autoButton'))}
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
                        sx={sectionCaptionSx}
                    >
                        {t('toolbar.sections.anomalies')}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Tooltip
                            title={t('toolbar.anomalies.settingsTooltip')}
                            arrow
                        >
                            <Button
                                size="small"
                                variant={isAnomalySettingsPanelOpen ? 'contained' : 'outlined'}
                                onClick={() => setIsAnomalySettingsPanelOpen((prev) => !prev)}
                                disabled={controlsDisabled}
                                startIcon={<AutoAwesomeIcon fontSize="small" />}
                                sx={actionButtonSx}
                                aria-label={t('toolbar.anomalies.settings')}
                            >
                                {renderButtonLabel(t('toolbar.anomalies.settings'))}
                            </Button>
                        </Tooltip>

                        <Tooltip
                            title={t('toolbar.anomalies.prev')}
                            arrow
                            describeChild
                        >
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={onNavigateToPreviousAnomaly}
                                    disabled={controlsDisabled || !canNavigateToPreviousAnomaly || !onNavigateToPreviousAnomaly}
                                    sx={{ p: 0.5 }}
                                    aria-label={t('toolbar.anomalies.prev')}
                                >
                                    <KeyboardArrowUpIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>

                        <Tooltip
                            title={t('toolbar.anomalies.next')}
                            arrow
                            describeChild
                        >
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={onNavigateToNextAnomaly}
                                    disabled={controlsDisabled || !canNavigateToNextAnomaly || !onNavigateToNextAnomaly}
                                    sx={{ p: 0.5 }}
                                    aria-label={t('toolbar.anomalies.next')}
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
                        justifyContent: 'flex-start',
                        flexShrink: 0,
                        gap: 1,
                    }}
                >
                    <Tooltip
                        title={t('toolbar.search.open')}
                        arrow
                        describeChild
                    >
                        <span>
                            <IconButton
                                ref={searchButtonRef}
                                size="small"
                                onClick={(event) => openSearchPopover(event.currentTarget)}
                                disabled={controlsDisabled}
                                color={isSearchOpen || searchTerm.trim().length > 0 ? 'primary' : 'default'}
                                sx={{ p: 0.5 }}
                                aria-label={t('toolbar.search.open')}
                            >
                                <SearchIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <Tooltip
                        title={t('toolbar.search.prev')}
                        arrow
                        describeChild
                    >
                        <span>
                            <IconButton
                                size="small"
                                onClick={onNavigateToPreviousSearchMatch}
                                disabled={controlsDisabled || !canNavigateToPreviousSearchMatch || !onNavigateToPreviousSearchMatch}
                                color={canNavigateToPreviousSearchMatch ? 'primary' : 'default'}
                                sx={{ p: 0.5 }}
                                aria-label={t('toolbar.search.prev')}
                            >
                                <KeyboardArrowUpIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <Tooltip
                        title={t('toolbar.search.next')}
                        arrow
                        describeChild
                    >
                        <span>
                            <IconButton
                                size="small"
                                onClick={onNavigateToNextSearchMatch}
                                disabled={controlsDisabled || !canNavigateToNextSearchMatch || !onNavigateToNextSearchMatch}
                                color={canNavigateToNextSearchMatch ? 'primary' : 'default'}
                                sx={{ p: 0.5 }}
                                aria-label={t('toolbar.search.next')}
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
                            title={filtersDisabled ? t('toolbar.filters.disabledWhileIndexing') : t('toolbar.filters.tooltip')}
                            arrow
                            describeChild
                        >
                            <Badge
                                color="primary"
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
                                    sx={actionButtonSx}
                                    aria-label={t('toolbar.filters.button')}
                                >
                                    {renderButtonLabel(t('toolbar.filters.button'))}
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
                PaperProps={{
                    sx: {
                        backgroundImage: 'none',
                    },
                }}
            >
                <Box sx={{ p: 1.5, width: 380 }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <TextField
                            id={LOG_TABLE_SEARCH_INPUT_ID}
                            label={t('toolbar.search.label')}
                            value={searchDraft}
                            onChange={(event) => {
                                setSearchDraft(event.target.value);
                                setSearchNotFound(false);
                            }}
                            onKeyDown={handleSearchInputKeyDown}
                            placeholder={t('toolbar.search.placeholder')}
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
                                            aria-label={t('toolbar.search.clearAria')}
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
                            {t('common.find')}
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
                            {t('toolbar.search.notFound')}
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
                PaperProps={{
                    sx: {
                        backgroundImage: 'none',
                    },
                }}
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
