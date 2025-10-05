import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const NotFoundPage: React.FC = () => (
    <Box 
        sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100vh' 
        }}
    >
        <Typography variant="h4">404 - Page Not Found</Typography>
    </Box>
);

export default NotFoundPage;