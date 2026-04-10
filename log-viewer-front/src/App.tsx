import { useEffect, useRef } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import AppRoutes from './routes/AppRoutes';
import { baseUrl } from './constants/BaseUrl';
import { setLogFile } from './redux/slices/logFileSlice';
import type { RootState } from './redux/store';
import { getLastSession, touchSession } from './utils/logIndexedDb';

console.log(baseUrl, 'baseUrl');


const router = createBrowserRouter(AppRoutes, {
    basename: baseUrl,
    future: {
        v7_relativeSplatPath: true,
        v7_fetcherPersist: true,
        v7_normalizeFormMethod: true,
        v7_partialHydration: true,
        v7_skipActionErrorRevalidation: true,
    },
});

export default function App () {
    const dispatch = useDispatch();
    const store = useStore<RootState>();
    const isLoaded = useSelector((state: RootState) => state.logFile.loaded);
    const hasRestoredRef = useRef(false);

    useEffect(() => {
        if (isLoaded || hasRestoredRef.current) return;
        hasRestoredRef.current = true;

        const restoreSession = async () => {
            const session = await getLastSession();
            if (!session) return;

            if (store.getState().logFile.loaded) {
                return;
            }

            dispatch(setLogFile({
                name: session.fileName,
                size: session.fileSize,
                format: session.formatId || 'Unknown',
                lastModified: session.lastModified,
                hasFileHandle: false,
                isLargeFile: session.fileSize >= 300 * 1024 * 1024,
                analyticsSessionId: session.sessionId,
            }));

            await touchSession(session.sessionId);
        };

        void restoreSession();
    }, [dispatch, isLoaded]);

    return (
        <RouterProvider
            router={router}
        />
    );
}
