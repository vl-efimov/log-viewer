import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { getPretrainedModels, type PretrainedModelInfo } from '@/services/anomalyApi';
import { useTranslation } from 'react-i18next';

let cachedPretrainedModels: PretrainedModelInfo[] | null = null;

/**
 * Page listing available pretrained anomaly models.
 */
const PretrainedModelsPage: React.FC = () => {
    const { t } = useTranslation();
    const [models, setModels] = useState<PretrainedModelInfo[]>(() => cachedPretrainedModels ?? []);
    const [loading, setLoading] = useState<boolean>(() => cachedPretrainedModels == null);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        let cancelled = false;

        const loadModels = async () => {
            const hasCachedModels = cachedPretrainedModels != null;
            setLoading(!hasCachedModels);
            setError('');
            try {
                const items = await getPretrainedModels();
                if (!cancelled) {
                    setModels(items);
                    cachedPretrainedModels = items;
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : t('pretrainedModels.errors.loadList'));
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

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h5">{t('pretrainedModels.title')}</Typography>
            <Typography
                variant="body2"
                color="text.secondary"
            >
                {t('pretrainedModels.description')}
            </Typography>

            {loading && (
                <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                >
                    <CircularProgress size={18} />
                    <Typography variant="body2">{t('pretrainedModels.loading')}</Typography>
                </Stack>
            )}

            {!loading && error && <Alert severity="error">{error}</Alert>}

            {!loading && !error && models.map((model) => (
                <Paper
                    key={model.id}
                    variant="outlined"
                    sx={{ p: 2 }}
                >
                    <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                        sx={{ mb: 1 }}
                    >
                        <Typography variant="h6">{model.name}</Typography>
                        <Chip
                            label={
                                model.status === 'ready'
                                    ? t('pretrainedModels.status.available')
                                    : t('pretrainedModels.status.unavailable')
                            }
                            color={model.status === 'ready' ? 'success' : 'default'}
                            size="small"
                        />
                    </Stack>
                    <Typography variant="body2"><strong>{t('pretrainedModels.labels.dataset')}:</strong> {model.dataset}</Typography>
                    <Typography variant="body2"><strong>{t('pretrainedModels.labels.architecture')}:</strong> {model.architecture}</Typography>
                </Paper>
            ))}
        </Box>
    );
};

export default PretrainedModelsPage;
