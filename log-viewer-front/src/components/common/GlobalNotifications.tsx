import Alert from '@mui/material/Alert';
import Snackbar, { type SnackbarCloseReason } from '@mui/material/Snackbar';
import { useDispatch, useSelector } from 'react-redux';
import { useCallback, type SyntheticEvent } from 'react';
import type { RootState } from '../../redux/store';
import { removeNotification } from '../../redux/slices/notificationsSlice';
import { APP_LAYOUT_TOKENS } from '../../design-tokens';

const statusBarOffsetPx = APP_LAYOUT_TOKENS.statusBar.height + 8;

const GlobalNotifications: React.FC = () => {
    const dispatch = useDispatch();
    const currentNotification = useSelector((state: RootState) => state.notifications.queue[0] ?? null);
    const notificationId = currentNotification?.id ?? null;

    const handleClose = useCallback((_event: Event | SyntheticEvent, reason?: SnackbarCloseReason) => {
        if (reason === 'clickaway') {
            return;
        }
        if (!notificationId) {
            return;
        }
        dispatch(removeNotification(notificationId));
    }, [dispatch, notificationId]);

    const handleAlertClose = useCallback(() => {
        if (!notificationId) {
            return;
        }
        dispatch(removeNotification(notificationId));
    }, [dispatch, notificationId]);

    if (!currentNotification) {
        return null;
    }

    return (
        <Snackbar
            key={currentNotification.id}
            open
            autoHideDuration={currentNotification.autoHideDuration}
            onClose={handleClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            sx={{
                '&.MuiSnackbar-root': {
                    bottom: `${statusBarOffsetPx}px`,
                    right: 16,
                    left: 'auto',
                },
            }}
        >
            <Alert
                onClose={handleAlertClose}
                severity={currentNotification.severity}
                variant="filled"
                sx={{
                    width: '100%',
                    minWidth: {
                        xs: 'calc(100vw - 32px)',
                        sm: 360,
                    },
                }}
            >
                {currentNotification.message}
            </Alert>
        </Snackbar>
    );
};

export default GlobalNotifications;
