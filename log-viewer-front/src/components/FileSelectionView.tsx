import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { useRef } from 'react';

interface FileSelectionViewProps {
    indexing: boolean;
    onFileSelect: () => Promise<boolean>;
    onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const FileSelectionView: React.FC<FileSelectionViewProps> = ({
    indexing,
    onFileSelect,
    onFileInputChange,
}) => {
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
            <Typography variant="h4" gutterBottom>
                Welcome to LogViewer!
            </Typography>
            <Typography
                variant="body1"
                sx={{
                    maxWidth: 500,
                    textAlign: 'center',
                }}
            >
                Select a log file to monitor in real-time. You can edit the file in any text editor, and changes will be reflected here automatically.
            </Typography>
            {indexing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <CircularProgress />
                    <Typography variant="body2" color="text.secondary">
                        Indexing large file...
                    </Typography>
                </Box>
            ) : (
                <Button
                    variant="contained"
                    startIcon={<CloudUploadIcon />}
                    size="large"
                    onClick={handleButtonClick}
                >
                    Select log file
                </Button>
            )}
            <input
                type="file"
                accept=".txt,.json,.log"
                style={{ display: 'none' }}
                ref={fileInputRef}
                onChange={onFileInputChange}
            />
        </Box>
    );
};
