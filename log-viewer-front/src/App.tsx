import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import AppRoutes from './routes/AppRoutes';

const router = createBrowserRouter(AppRoutes, {
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
