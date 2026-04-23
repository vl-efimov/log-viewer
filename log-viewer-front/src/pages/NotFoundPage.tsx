import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

const NotFoundPage: React.FC = () => {
    const { t } = useTranslation();

    return (
        <Box
            sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
            }}
        >
            <Typography variant="h4">{t('notFound.title')}</Typography>
        </Box>
    );
};

export default NotFoundPage;