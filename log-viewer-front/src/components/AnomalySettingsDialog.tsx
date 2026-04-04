import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MemoryIcon from '@mui/icons-material/Memory';
import StorageIcon from '@mui/icons-material/Storage';
import TroubleshootIcon from '@mui/icons-material/Troubleshoot';
import type { AnomalySettings } from '../utils/anomalySettings';

interface AnomalySettingsDialogProps {
    open: boolean;
    onClose: () => void;
    selectedModelId: 'bgl' | 'hdfs';
    anomalySettings: AnomalySettings;
    thresholdRange: { min: number; max: number; step: number };
    stepSizeRange: { min: number; max: number; step: number };
    minRegionLinesRange: { min: number; max: number; step: number };
    isAnomalyLoading: boolean;
    canRunAnomalyAnalysis: boolean;
    anomalyDisabledReason?: string;
    onAnomalySettingsChange: (patch: Partial<AnomalySettings>) => void;
    onSensitivityProfileApply: (profileId: 'sensitive' | 'balanced' | 'strict') => void;
    onResetAnomalySettings: () => void;
    onSelectedModelChange: (value: 'bgl' | 'hdfs') => void;
    onRunAnomalyAnalysis: () => void;
}

const AnomalySettingsDialog: React.FC<AnomalySettingsDialogProps> = ({
    open,
    onClose,
    selectedModelId,
    anomalySettings,
    thresholdRange,
    stepSizeRange,
    minRegionLinesRange,
    isAnomalyLoading,
    canRunAnomalyAnalysis,
    anomalyDisabledReason,
    onAnomalySettingsChange,
    onSensitivityProfileApply,
    onResetAnomalySettings,
    onSelectedModelChange,
    onRunAnomalyAnalysis,
}) => {
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

    const handleModelChange = (_event: React.MouseEvent<HTMLElement>, value: 'bgl' | 'hdfs' | null) => {
        if (value) {
            onSelectedModelChange(value);
        }
    };

    const isAnalyzeDisabled = isAnomalyLoading || !canRunAnomalyAnalysis;
    const analyzeTooltip = isAnalyzeDisabled && anomalyDisabledReason
        ? anomalyDisabledReason
        : 'Analyze anomalies';

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="sm"
        >
            <DialogTitle>Anomaly Analysis</DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                <Stack spacing={1.5}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                        <ToggleButtonGroup
                            size="small"
                            value={selectedModelId}
                            exclusive
                            onChange={handleModelChange}
                            aria-label="model"
                        >
                            <ToggleButton value="bgl" aria-label="model bgl">
                                <Tooltip title="Model: BGL" arrow>
                                    <MemoryIcon fontSize="small" />
                                </Tooltip>
                            </ToggleButton>
                            <ToggleButton value="hdfs" aria-label="model hdfs">
                                <Tooltip title="Model: HDFS" arrow>
                                    <StorageIcon fontSize="small" />
                                </Tooltip>
                            </ToggleButton>
                        </ToggleButtonGroup>

                        <Tooltip title={analyzeTooltip} arrow>
                            <span>
                                <Button
                                    size="small"
                                    variant="contained"
                                    onClick={onRunAnomalyAnalysis}
                                    startIcon={<TroubleshootIcon />}
                                    disabled={isAnalyzeDisabled}
                                >
                                    Analyze
                                </Button>
                            </span>
                        </Tooltip>
                    </Stack>

                    {!isAnomalyLoading && !canRunAnomalyAnalysis && anomalyDisabledReason && (
                        <Typography variant="caption" color="text.secondary">
                            {anomalyDisabledReason}
                        </Typography>
                    )}

                    <Stack spacing={0.5}>
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

                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'flex-start' } }}>
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
                    </Stack>
                </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button size="small" variant="text" onClick={onResetAnomalySettings}>Reset</Button>
                <Button size="small" onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default AnomalySettingsDialog;
