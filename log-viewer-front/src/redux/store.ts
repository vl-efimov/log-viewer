import { configureStore } from '@reduxjs/toolkit';
import logFileReducer from '@/redux/slices/logFileSlice';
import anomalyReducer from '@/redux/slices/anomalySlice';
import notificationsReducer from '@/redux/slices/notificationsSlice';

const store = configureStore({
    reducer: {
        logFile: logFileReducer,
        anomaly: anomalyReducer,
        notifications: notificationsReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;