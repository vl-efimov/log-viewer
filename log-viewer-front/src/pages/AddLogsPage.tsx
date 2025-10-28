import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { useRef } from 'react';

const AddLogsPage: React.FC = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleButtonClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                border: '2px dashed #ccc',
                height: '100%',
                width: '100%',
            }}
        >
            <Typography
                variant="h4"
                gutterBottom
            >
                Welcome to LogViewer!
            </Typography>
            <Typography
                variant="body1"
                sx={{
                    maxWidth: 500,
                    textAlign: 'center',
                }}
            >
                Upload a log file to start viewing and analyzing. Text and JSON files are supported.
            </Typography>
            <Button
                variant="contained"
                startIcon={<CloudUploadIcon />}
                size="large"
                onClick={handleButtonClick}
            >
                Upload log file
            </Button>
            <input
                type="file"
                accept=".txt,.json,.log"
                style={{ display: 'none' }}
                ref={fileInputRef}
                // onChange={handleFileSelect}
            />
        </Box>
    );
}

export default AddLogsPage;