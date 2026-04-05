import { configureStore } from '@reduxjs/toolkit';
import logFileReducer from './slices/logFileSlice';
import anomalyReducer from './slices/anomalySlice';

const store = configureStore({
    reducer: {
        logFile: logFileReducer,
        anomaly: anomalyReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;