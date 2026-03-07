import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import AppRoutes from './routes/AppRoutes';
import { baseUrl } from './constants/BaseUrl';

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
    return (
        <RouterProvider
            router={router}
        />
    );
}
