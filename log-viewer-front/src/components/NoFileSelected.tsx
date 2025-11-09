import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useNavigate } from 'react-router-dom';
import { RouteHome } from '../routes/routePaths';

interface NoFileSelectedProps {
    title?: string;
    description?: string;
    showButton?: boolean;
}

const NoFileSelected: React.FC<NoFileSelectedProps> = ({ 
    title = "No file selected",
    description = "Please select a log file from the Home page to start monitoring.",
    showButton = true
}) => {
    const navigate = useNavigate();

    const handleBackToHome = () => {
        navigate(RouteHome);
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: 2,
                p: 3,
            }}
        >
            <Typography variant="h5" gutterBottom>
                {title}
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center">
                {description}
            </Typography>
            {showButton && (
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleBackToHome}
                >
                    Go to Home
                </Button>
            )}
        </Box>
    );
};

export default NoFileSelected;
