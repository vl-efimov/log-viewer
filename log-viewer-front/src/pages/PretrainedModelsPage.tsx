import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { getPretrainedModels, warmupBglModel, type PretrainedModelInfo } from '../services/bglAnomalyApi';

const PretrainedModelsPage: React.FC = () => {
    const [models, setModels] = useState<PretrainedModelInfo[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [installing, setInstalling] = useState<boolean>(false);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        let cancelled = false;

        const loadModels = async () => {
            setLoading(true);
            setError('');
            try {
                const items = await getPretrainedModels();
                if (!cancelled) {
                    setModels(items);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load model list');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadModels();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const hasInstalling = models.some((model) => model.status === 'installing');
        if (!hasInstalling) {
            return;
        }

        const timer = window.setInterval(() => {
            void refreshModels();
        }, 1500);

        return () => {
            window.clearInterval(timer);
        };
    }, [models]);

    const refreshModels = async () => {
        const items = await getPretrainedModels();
        setModels(items);
    };

    const handlePrepareModel = async (modelId: string) => {
        setInstalling(true);
        setError('');
        try {
            await warmupBglModel(modelId);
            await refreshModels();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to prepare model');
        } finally {
            setInstalling(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h5">Pretrained Models</Typography>
            <Typography variant="body2" color="text.secondary">
                Available backend models for anomaly detection.
            </Typography>

            {loading && (
                <Stack direction="row" spacing={1} alignItems="center">
                    <CircularProgress size={18} />
                    <Typography variant="body2">Loading models...</Typography>
                </Stack>
            )}

            {!loading && error && <Alert severity="error">{error}</Alert>}

            {!loading && !error && models.map((model) => (
                <Paper key={model.id} variant="outlined" sx={{ p: 2 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="h6">{model.name}</Typography>
                        <Chip
                            label={
                                model.status === 'ready'
                                    ? 'Ready'
                                    : model.status === 'installing'
                                        ? 'Preparing'
                                        : 'Unavailable'
                            }
                            color={model.status === 'ready' ? 'success' : 'default'}
                            size="small"
                        />
                    </Stack>
                    <Typography variant="body2"><strong>Dataset:</strong> {model.dataset}</Typography>
                    <Typography variant="body2"><strong>Architecture:</strong> {model.architecture}</Typography>
                    {model.status === 'installing' && (
                        <>
                            <Typography variant="body2"><strong>Stage:</strong> {model.prepareStage}</Typography>
                            <Typography variant="body2"><strong>Status:</strong> {model.prepareMessage}</Typography>
                        </>
                    )}
                    {model.prepareError && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                            {model.prepareError}
                        </Alert>
                    )}
                    {model.status === 'installing' && (
                        <Box sx={{ mt: 1 }}>
                            <LinearProgress variant="determinate" value={model.prepareProgress} />
                            <Typography variant="caption" color="text.secondary">
                                {model.prepareProgress}%
                            </Typography>
                        </Box>
                    )}
                    {model.status !== 'ready' && (
                        <Box sx={{ mt: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={() => handlePrepareModel(model.modelId)}
                                disabled={installing}
                            >
                                Prepare Model
                            </Button>
                            {installing && <CircularProgress size={16} />}
                        </Box>
                    )}
                </Paper>
            ))}
        </Box>
    );
};

export default PretrainedModelsPage;
