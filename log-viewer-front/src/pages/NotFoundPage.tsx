import React from 'react';
import { Box, Typography } from '@mui/material';

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