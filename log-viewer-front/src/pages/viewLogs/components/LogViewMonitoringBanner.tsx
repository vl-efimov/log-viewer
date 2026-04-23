import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { FC } from 'react';

interface LogViewMonitoringBannerProps {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
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
            }}
        >
            <Alert
                severity="info"
                variant="outlined"
                action={actionLabel && onAction
                    ? (
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={onAction}
                        >
                            {actionLabel}
                        </Button>
                    )
                    : undefined}
                sx={{
                    width: '100%',
                    minWidth: 0,
                    alignItems: 'center',
                    py: 0.25,
                    '& .MuiAlert-message': {
                        display: 'flex',
                        alignItems: 'center',
                        flex: 1,
                        minWidth: 0,
                    },
                    '& .MuiAlert-action': {
                        ml: 'auto',
                        pl: 2,
                        mr: 0,
                        alignItems: 'center',
                        display: 'flex',
                    },
                }}
            >
                <Typography variant="body2">
                    {message}
                </Typography>
            </Alert>
        </Box>
    );
};

export default LogViewMonitoringBanner;
