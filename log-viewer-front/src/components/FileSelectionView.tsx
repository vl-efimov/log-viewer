import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { alpha } from '@mui/material/styles';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface FileSelectionViewProps {
    indexing: boolean;
    onFileSelect: () => Promise<boolean>;
    onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onFileDrop?: (file: File) => Promise<void> | void;
}

export const FileSelectionView: React.FC<FileSelectionViewProps> = ({
    indexing,
    onFileSelect,
    onFileInputChange,
    onFileDrop,
}) => {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleButtonClick = async () => {
        // Try File System Access API first, fallback to input
        const handled = await onFileSelect();
        if (!handled) {
            fileInputRef.current?.click();
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                width: '100%',
                overflow: 'hidden',
                px: { xs: 2, sm: 3 },
                py: { xs: 3, sm: 4 },
            }}
        >
            <Box
                sx={{
                    width: '100%',
                    maxWidth: 640,
                    px: { xs: 3, sm: 5 },
                    py: { xs: 5, sm: 6 },
                    borderRadius: 4,
                    textAlign: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    background: (theme) =>
                        theme.palette.mode === 'light'
                            ? 'linear-gradient(165deg, rgba(255,255,255,0.96) 0%, rgba(238,246,255,0.92) 100%)'
                            : 'linear-gradient(165deg, rgba(15,23,42,0.88) 0%, rgba(30,41,59,0.9) 100%)',
                    boxShadow: (theme) =>
                        theme.palette.mode === 'light'
                            ? '0 18px 45px rgba(15, 23, 42, 0.12)'
                            : '0 20px 50px rgba(2, 6, 23, 0.5)',
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 4,
                        background: 'linear-gradient(90deg, #06b6d4 0%, #3b82f6 45%, #10b981 100%)',
                    },
                }}
            >
            <Typography
                variant="h4"
                sx={{ mb: 1.5, fontWeight: 700, mt: 0.5 }}
            >
                {t('fileSelection.title')}
            </Typography>
            <Typography
                variant="body1"
                color="text.secondary"
                sx={{
                    maxWidth: 520,
                    mx: 'auto',
                    mb: 1.5,
                }}
            >
                {t('fileSelection.description')}
            </Typography>
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 4 }}
            >
                TXT, LOG, JSON
            </Typography>
            {indexing ? (
                <Box
                    sx={{
                        display: 'inline-flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        px: 3,
                        py: 2.5,
                        borderRadius: 3,
                        backgroundColor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'light' ? 0.55 : 0.22),
                        border: (theme) => `1px solid ${alpha(theme.palette.divider, 0.9)}`,
                    }}
                >
                    <CircularProgress size={28} />
                    <Typography
                        variant="body2"
                        color="text.secondary"
                    >
                        {t('fileSelection.indexing')}
                    </Typography>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <Button
                        variant="contained"
                        startIcon={<CloudUploadIcon />}
                        size="large"
                        onClick={handleButtonClick}
                        sx={{
                            px: 3.5,
                            py: 1.2,
                            borderRadius: 2.5,
                            textTransform: 'uppercase',
                            fontWeight: 700,
                            letterSpacing: '0.03em',
                            boxShadow: (theme) => `0 12px 28px ${alpha(theme.palette.primary.main, 0.28)}`,
                        }}
                    >
                        {t('fileSelection.selectButton')}
                    </Button>
                </Box>
            )}
            <input
                type="file"
                accept=".txt,.json,.log"
                style={{ display: 'none' }}
                ref={fileInputRef}
                onChange={onFileInputChange}
                onDrop={(event) => {
                    if (!onFileDrop) return;
                    const file = event.dataTransfer.files?.[0];
                    if (!file) return;
                    void onFileDrop(file);
                }}
            />
        </Box>
        </Box>
    );
};
