import { configureStore } from '@reduxjs/toolkit';
import fileReducer from './slices/fileSlice';
import logFileReducer from './slices/logFileSlice';

const store = configureStore({
    reducer: {
        file: fileReducer,
        logFile: logFileReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;