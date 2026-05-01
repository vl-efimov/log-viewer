import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { RouteViewLogs } from '@/routes/routePaths';

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
                    maxWidth: 680,
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
                    sx={{ mb: 1.5, fontWeight: 700 }}
                >
                    {title}
                </Typography>
                <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{
                        maxWidth: 560,
                        mx: 'auto',
                        mb: showButton ? 4 : 0,
                    }}
                >
                    {description}
                </Typography>
                {showButton && (
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={handleBackToHome}
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
                            {buttonText}
                        </Button>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default NoFileSelected;
