import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import StarIcon from '@mui/icons-material/Star';
import { useRef } from 'react';
import type { AnomalySettings } from '../utils/anomalySettings';

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
    const settingsAnchorRef = useRef<HTMLButtonElement | null>(null);
    const selectedSensitivityProfile =
        Math.abs(anomalySettings.threshold - 0.35) < 0.001
        && anomalySettings.stepSize === 5
        && anomalySettings.minRegionLines === 1
            ? 'sensitive'
            : Math.abs(anomalySettings.threshold - 0.5) < 0.001
                && anomalySettings.stepSize === 10
                && anomalySettings.minRegionLines === 2
                ? 'balanced'
                : Math.abs(anomalySettings.threshold - 0.7) < 0.001
                    && anomalySettings.stepSize === 20
                    && anomalySettings.minRegionLines === 3
                    ? 'strict'
                    : null;

    const handleViewModeChange = (_event: React.MouseEvent<HTMLElement>, value: 'live-tail' | 'normal' | null) => {
        if (value) {
            onViewModeChange(value);
        }
    };

    return (
        <>
            <Box sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                <Typography
                    variant="button"
                    sx={{
                        cursor: 'pointer',
                        color: 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: 0.8 }
                    }}
                    onClick={onManualRefresh}
                >
                    Refresh Now
                </Typography>
                <Typography
                    variant="button"
                    sx={{
                        cursor: (isAnomalyLoading || !canRunAnomalyAnalysis) ? 'default' : 'pointer',
                        color: (isAnomalyLoading || !canRunAnomalyAnalysis) ? 'text.disabled' : 'primary.main',
                        textDecoration: 'underline',
                        '&:hover': { opacity: (isAnomalyLoading || !canRunAnomalyAnalysis) ? 1 : 0.8 }
                    }}
                    onClick={() => {
                        if (!isAnomalyLoading && canRunAnomalyAnalysis) {
                            onRunAnomalyAnalysis();
                        }
                    }}
                >
                    Analyze Anomalies
                </Typography>
                <TextField
                    size="small"
                    select
                    label="Model"
                    value={selectedModelId}
                    onChange={(event) => onSelectedModelChange(event.target.value as 'bgl' | 'hdfs')}
                    sx={{ minWidth: 120 }}
                >
                    <MenuItem value="bgl">BGL</MenuItem>
                    <MenuItem value="hdfs">HDFS</MenuItem>
                </TextField>
                <Tooltip title="Open model parameter panel" arrow>
                    <IconButton
                        ref={settingsAnchorRef}
                        size="small"
                        color={isAnomalySettingsPanelOpen ? 'primary' : 'default'}
                        onClick={onToggleAnomalySettingsPanel}
                    >
                        {isAnomalySettingsPanelOpen ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                    </IconButton>
                </Tooltip>
                <Chip
                    label={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                    color={autoRefresh ? 'success' : 'default'}
                    onClick={onToggleAutoRefresh}
                    size="small"
                    sx={{ cursor: 'pointer' }}
                />
                <ToggleButtonGroup
                    size="small"
                    value={viewMode}
                    exclusive
                    onChange={handleViewModeChange}
                    aria-label="log view mode"
                    sx={{ ml: 1 }}
                >
                    <ToggleButton value="live-tail" aria-label="live tail">
                        LiveTail
                    </ToggleButton>
                    <ToggleButton value="normal" aria-label="normal view">
                        Normal
                    </ToggleButton>
                </ToggleButtonGroup>
                {newLinesCount > 0 && (
                    <Chip
                        label={`+${newLinesCount} new`}
                        color="success"
                        size="small"
                        variant="outlined"
                        sx={{
                            animation: 'pulse 0.5s ease-in-out',
                            '@keyframes pulse': {
                                '0%': { transform: 'scale(1)' },
                                '50%': { transform: 'scale(1.1)' },
                                '100%': { transform: 'scale(1)' },
                            }
                        }}
                    />
                )}
                {!isAnomalyLoading && !canRunAnomalyAnalysis && anomalyDisabledReason && (
                    <Chip label={anomalyDisabledReason} size="small" color="default" variant="outlined" />
                )}
            </Box>

            <Popover
                open={isAnomalySettingsPanelOpen}
                anchorEl={settingsAnchorRef.current}
                onClose={onToggleAnomalySettingsPanel}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            >
                <Paper sx={{ p: 1.5, maxWidth: 540 }}>
                    <Stack spacing={0.5} sx={{ mb: 1 }}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                            <Typography variant="subtitle2">Model Analysis Settings</Typography>
                            <Tooltip
                                title="These parameters are applied to anomaly calculation for the selected model."
                                arrow
                            >
                                <InfoOutlinedIcon fontSize="inherit" />
                            </Tooltip>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                            {selectedModelId.toUpperCase()} parameters used for anomaly calculation.
                        </Typography>
                    </Stack>

                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'flex-start' }, mb: 1 }}>
                        <Box sx={{ minWidth: 150 }}>
                            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                                <Typography variant="caption">Threshold</Typography>
                                <Tooltip title="Lower value finds more anomalies, higher value is stricter." arrow>
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                fullWidth
                                size="small"
                                type="number"
                                value={anomalySettings.threshold}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    onAnomalySettingsChange({
                                        threshold: Math.max(thresholdRange.min, Math.min(thresholdRange.max, next)),
                                    });
                                }}
                                inputProps={{ min: thresholdRange.min, max: thresholdRange.max, step: thresholdRange.step }}
                            />
                        </Box>
                        <Box sx={{ minWidth: 130 }}>
                            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                                <Typography variant="caption">Step Size</Typography>
                                <Tooltip title="Window shift between checks. Smaller is more detailed but slower." arrow>
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                fullWidth
                                size="small"
                                type="number"
                                value={anomalySettings.stepSize}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    onAnomalySettingsChange({
                                        stepSize: Math.max(stepSizeRange.min, Math.min(stepSizeRange.max, Math.round(next))),
                                    });
                                }}
                                inputProps={{ min: stepSizeRange.min, max: stepSizeRange.max, step: stepSizeRange.step }}
                            />
                        </Box>
                        <Box sx={{ minWidth: 130 }}>
                            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                                <Typography variant="caption">Min Region</Typography>
                                <Tooltip title="Minimum continuous anomaly block length to reduce noise." arrow>
                                    <InfoOutlinedIcon fontSize="inherit" />
                                </Tooltip>
                            </Stack>
                            <TextField
                                fullWidth
                                size="small"
                                type="number"
                                value={anomalySettings.minRegionLines}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (!Number.isFinite(next)) return;
                                    onAnomalySettingsChange({
                                        minRegionLines: Math.max(minRegionLinesRange.min, Math.min(minRegionLinesRange.max, Math.round(next))),
                                    });
                                }}
                                inputProps={{ min: minRegionLinesRange.min, max: minRegionLinesRange.max, step: minRegionLinesRange.step }}
                            />
                        </Box>
                    </Stack>

                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                        <Tooltip title="High sensitivity: catches more anomalies, may include noise." arrow>
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'sensitive' ? 'contained' : 'outlined'}
                                onClick={() => onSensitivityProfileApply('sensitive')}
                            >
                                Sensitive
                            </Button>
                        </Tooltip>
                        <Tooltip title="Balanced mode: recommended default tradeoff." arrow>
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'balanced' ? 'contained' : 'outlined'}
                                onClick={() => onSensitivityProfileApply('balanced')}
                            >
                                Balanced
                            </Button>
                        </Tooltip>
                        <Tooltip title="Strict mode: fewer false positives, stronger anomaly signal only." arrow>
                            <Button
                                size="small"
                                variant={selectedSensitivityProfile === 'strict' ? 'contained' : 'outlined'}
                                onClick={() => onSensitivityProfileApply('strict')}
                            >
                                Strict
                            </Button>
                        </Tooltip>
                        <Tooltip title="Reset parameters to default values for the selected model." arrow>
                            <Button size="small" variant="text" onClick={onResetAnomalySettings}>Reset</Button>
                        </Tooltip>
                    </Stack>
                </Paper>
            </Popover>
        </>
    );
};

export default LogToolbar;
