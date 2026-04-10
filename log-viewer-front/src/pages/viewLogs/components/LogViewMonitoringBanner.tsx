import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { FC } from 'react';

interface LogViewMonitoringBannerProps {
    message: string;
    actionLabel: string;
    onAction: () => void;
}

const LogViewMonitoringBanner: FC<LogViewMonitoringBannerProps> = ({
    message,
    actionLabel,
    onAction,
}) => {
    return (
        <Box
            sx={{
                mb: 1,
                p: 2,
                borderRadius: 1,
                border: (theme) => `1px solid ${theme.palette.divider}`,
                backgroundColor: (theme) => theme.palette.background.paper,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 2,
            }}
        >
            <Typography
                variant="body2"
                color="text.secondary"
            >
                {message}
            </Typography>
            <Button
                variant="outlined"
                size="small"
                onClick={onAction}
            >
                {actionLabel}
            </Button>
        </Box>
    );
};

export default LogViewMonitoringBanner;
