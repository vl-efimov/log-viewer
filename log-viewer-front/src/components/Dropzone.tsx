import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { styled } from '@mui/system';
import { useDispatch } from 'react-redux';
import { setFileData } from '../redux/slices/fileSlice';

const Dropzone = styled('div')(() => ({
    border: '2px dashed #ccc',
    borderRadius: '4px',
    width: '100%',
    height: '80vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9f9f9',
    cursor: 'pointer',
    '&:hover': {
        backgroundColor: '#f1f1f1',
    },
}));

const FileUpload: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const dispatch = useDispatch();

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const droppedFile = event.dataTransfer.files[0];
        if (validateFile(droppedFile)) {
            setFile(droppedFile);
            readFileContent(droppedFile);
        } else {
            alert('Invalid file type. Please upload a text or JSON file.');
        }
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile && validateFile(selectedFile)) {
            setFile(selectedFile);
            readFileContent(selectedFile);
        } else {
            alert('Invalid file type. Please upload a text or JSON file.');
        }
    };

    const validateFile = (file: File) => {
        const validTypes = ['text/plain', 'application/json', 'application/xml'];
        return validTypes.includes(file.type);
    };

    const readFileContent = (file: File) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            dispatch(setFileData(content));
        };
        reader.readAsText(file);
    };

    return (
        <Box
            sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
            {file && (
                <Typography variant="body1" sx={{ mt: 2 }}>
                    Selected file: {file.name}
                </Typography>
            )}
            <Dropzone onDragOver={(event: React.DragEvent<HTMLDivElement>) => event.preventDefault()} onDrop={handleDrop}>
                <CloudUploadIcon sx={{ fontSize: 48, color: '#ccc' }} />
                <Typography variant="h6" sx={{ mt: 2 }}>
                    Drag and drop your log file here
                </Typography>
                <input
                    type="file"
                    accept=".txt,.json,.log"
                    style={{ display: 'none' }}
                    id="file-upload"
                    onChange={handleFileSelect}
                />
                <label htmlFor="file-upload">
                    <Button variant="contained" component="span" sx={{ mt: 2 }}>
                        Select File
                    </Button>
                </label>
            </Dropzone>
        </Box>
    );
};

export default FileUpload;
