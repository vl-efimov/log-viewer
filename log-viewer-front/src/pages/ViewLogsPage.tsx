import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';
import { Box, Typography } from '@mui/material';

const ViewLogsPage: React.FC = () => {
    const fileContent = useSelector((state: RootState) => state.file.data);

    return (
        <Box>
            <Typography variant="h6">File Content:</Typography>
            {fileContent ? (
                <pre>{fileContent}</pre>
            ) : (
                <Typography variant="body1">No file content available.</Typography>
            )}
        </Box>
    );
}

export default ViewLogsPage;