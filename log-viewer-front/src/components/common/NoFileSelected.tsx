import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useNavigate } from 'react-router-dom';
import { RouteViewLogs } from '../../routes/routePaths';

interface NoFileSelectedProps {
    title?: string;
    description?: string;
    showButton?: boolean;
    buttonText?: string;
}

const NoFileSelected: React.FC<NoFileSelectedProps> = ({ 
    title = "No file selected",
    description = "Please select a log file from the Home page to start monitoring.",
    showButton = true,
    buttonText = "Go to File Upload"
}) => {
    const navigate = useNavigate();

    const handleBackToHome = () => {
        navigate(`/${RouteViewLogs}`);
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
            <Typography
                variant="h5"
                gutterBottom
            >
                {title}
            </Typography>
            <Typography
                variant="body1"
                color="text.secondary"
                textAlign="center"
            >
                {description}
            </Typography>
            {showButton && (
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleBackToHome}
                >
                    {buttonText}
                </Button>
            )}
        </Box>
    );
};

export default NoFileSelected;
