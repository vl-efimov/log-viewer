import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

const SettingsPage: React.FC = () => {
    const { t } = useTranslation();

    return (
        <Typography variant="h5">{t('settings.title')}</Typography>
    );
}

export default SettingsPage;