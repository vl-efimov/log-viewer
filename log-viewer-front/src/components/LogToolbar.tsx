import Box from '@mui/material/Box';
import Badge from '@mui/material/Badge';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import StreamIcon from '@mui/icons-material/Stream';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import NotificationsIcon from '@mui/icons-material/Notifications';
import type { AnomalySettings } from '../utils/anomalySettings';
import AnomalySettingsDialog from './AnomalySettingsDialog';

interface LogToolbarProps {
    onManualRefresh: () => void;
    autoRefresh: boolean;
    onToggleAutoRefresh: () => void;
    viewMode: 'live-tail' | 'normal';
    onViewModeChange: (mode: 'live-tail' | 'normal') => void;
    newLinesCount: number;
    isAnomalyLoading: boolean;
    canRunAnomalyAnalysis: boolean;
    anomalyDisabledReason?: string;
    selectedModelId: 'bgl' | 'hdfs';
    anomalySettings: AnomalySettings;
    thresholdRange: { min: number; max: number; step: number };
    stepSizeRange: { min: number; max: number; step: number };
    minRegionLinesRange: { min: number; max: number; step: number };
    isAnomalySettingsPanelOpen: boolean;
    onToggleAnomalySettingsPanel: () => void;
    onAnomalySettingsChange: (patch: Partial<AnomalySettings>) => void;
    onSensitivityProfileApply: (profileId: 'sensitive' | 'balanced' | 'strict') => void;
    onResetAnomalySettings: () => void;
    onSelectedModelChange: (value: 'bgl' | 'hdfs') => void;
    onRunAnomalyAnalysis: () => void;
}

const LogToolbar: React.FC<LogToolbarProps> = ({
    onManualRefresh,
    autoRefresh,
    onToggleAutoRefresh,
    viewMode,
    onViewModeChange,
    newLinesCount,
    isAnomalyLoading,
    canRunAnomalyAnalysis,
    anomalyDisabledReason,
    selectedModelId,
    anomalySettings,
    thresholdRange,
    stepSizeRange,
    minRegionLinesRange,
    isAnomalySettingsPanelOpen,
    onToggleAnomalySettingsPanel,
    onAnomalySettingsChange,
    onSensitivityProfileApply,
    onResetAnomalySettings,
    onSelectedModelChange,
    onRunAnomalyAnalysis,
}) => {
    const handleViewModeChange = (_event: React.MouseEvent<HTMLElement>, value: 'live-tail' | 'normal' | null) => {
        if (value) {
            onViewModeChange(value);
        }
    };

    return (
        <>
            <Paper
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    mb: 1,
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    flexWrap: 'wrap',
                }}
                elevation={0}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Refresh now" arrow>
                        <IconButton size="small" onClick={onManualRefresh} aria-label="refresh now">
                            <RefreshIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>

                    <Tooltip title={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'} arrow>
                        <IconButton
                            size="small"
                            onClick={onToggleAutoRefresh}
                            color={autoRefresh ? 'success' : 'default'}
                            aria-label="toggle auto refresh"
                        >
                            <AutorenewIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>

                <Divider orientation="vertical" flexItem />

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Anomaly settings" arrow>
                        <IconButton
                            size="small"
                            color={isAnomalySettingsPanelOpen ? 'primary' : 'default'}
                            onClick={onToggleAnomalySettingsPanel}
                            aria-label="anomaly settings"
                        >
                            <AutoAwesomeIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>

                <Divider orientation="vertical" flexItem />

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ToggleButtonGroup
                        size="small"
                        value={viewMode}
                        exclusive
                        onChange={handleViewModeChange}
                        aria-label="log view mode"
                    >
                        <Tooltip title="Live tail" arrow>
                            <ToggleButton value="live-tail" aria-label="live tail">
                                <StreamIcon fontSize="small" />
                            </ToggleButton>
                        </Tooltip>
                        <Tooltip title="Normal view" arrow>
                            <ToggleButton value="normal" aria-label="normal view">
                                <FormatListBulletedIcon fontSize="small" />
                            </ToggleButton>
                        </Tooltip>
                    </ToggleButtonGroup>

                    {newLinesCount > 0 && (
                        <Tooltip title={`${newLinesCount} new lines`} arrow>
                            <span>
                                <IconButton size="small" aria-label="new lines" disabled>
                                    <Badge badgeContent={newLinesCount} color="success" max={999}>
                                        <NotificationsIcon fontSize="small" />
                                    </Badge>
                                </IconButton>
                            </span>
                        </Tooltip>
                    )}
                </Box>
            </Paper>

            <AnomalySettingsDialog
                open={isAnomalySettingsPanelOpen}
                onClose={onToggleAnomalySettingsPanel}
                selectedModelId={selectedModelId}
                anomalySettings={anomalySettings}
                thresholdRange={thresholdRange}
                stepSizeRange={stepSizeRange}
                minRegionLinesRange={minRegionLinesRange}
                isAnomalyLoading={isAnomalyLoading}
                canRunAnomalyAnalysis={canRunAnomalyAnalysis}
                anomalyDisabledReason={anomalyDisabledReason}
                onAnomalySettingsChange={onAnomalySettingsChange}
                onSensitivityProfileApply={onSensitivityProfileApply}
                onResetAnomalySettings={onResetAnomalySettings}
                onSelectedModelChange={onSelectedModelChange}
                onRunAnomalyAnalysis={onRunAnomalyAnalysis}
            />
        </>
    );
};

export default LogToolbar;
