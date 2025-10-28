import { configureStore } from '@reduxjs/toolkit';
import logFileReducer from './slices/logFileSlice';

const store = configureStore({
    reducer: {
        logFile: logFileReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;