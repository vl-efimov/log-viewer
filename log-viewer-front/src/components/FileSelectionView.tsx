import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
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
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                height: '100%',
                width: '100%',
            }}
        >
            <Typography
                variant="h4"
                gutterBottom
            >
                {t('fileSelection.title')}
            </Typography>
            <Typography
                variant="body1"
                sx={{
                    maxWidth: 500,
                    textAlign: 'center',
                }}
            >
                {t('fileSelection.description')}
            </Typography>
            {indexing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <CircularProgress />
                    <Typography
                        variant="body2"
                        color="text.secondary"
                    >
                        {t('fileSelection.indexing')}
                    </Typography>
                </Box>
            ) : (
                <Button
                    variant="contained"
                    startIcon={<CloudUploadIcon />}
                    size="large"
                    onClick={handleButtonClick}
                >
                    {t('fileSelection.selectButton')}
                </Button>
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
    );
};
