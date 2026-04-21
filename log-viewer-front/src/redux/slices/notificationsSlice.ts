import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error';

export interface AppNotification {
    id: string;
    message: string;
    severity: NotificationSeverity;
    autoHideDuration: number;
}

type EnqueueNotificationPayload = {
    message: string;
    severity?: NotificationSeverity;
    autoHideDuration?: number;
};

interface NotificationsState {
    queue: AppNotification[];
}

const initialNotificationsState: NotificationsState = {
    queue: [],
};

let notificationCounter = 0;

const notificationsSlice = createSlice({
    name: 'notifications',
    initialState: initialNotificationsState,
    reducers: {
        enqueueNotification: (state, action: PayloadAction<EnqueueNotificationPayload>) => {
            notificationCounter += 1;
            state.queue.push({
                id: `notification-${Date.now()}-${notificationCounter}`,
                message: action.payload.message,
                severity: action.payload.severity ?? 'success',
                autoHideDuration: action.payload.autoHideDuration ?? 5000,
            });
        },
        removeNotification: (state, action: PayloadAction<string>) => {
            state.queue = state.queue.filter((notification) => notification.id !== action.payload);
        },
        clearNotifications: (state) => {
            state.queue = [];
        },
    },
});

export const {
    enqueueNotification,
    removeNotification,
    clearNotifications,
} = notificationsSlice.actions;

export default notificationsSlice.reducer;
