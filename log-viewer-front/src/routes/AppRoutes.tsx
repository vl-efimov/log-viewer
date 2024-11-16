import { Navigate, RouteObject } from 'react-router-dom';

import MainLayout from '../layouts/MainLayout';
import AddLogsPage from '../pages/AddLogsPage';
import AnomaliesPage from '../pages/AnomaliesPage';
import CommonPatternsPage from '../pages/CommonPatternsPage';
import DashboardPage from '../pages/DashboardPage';
import SettingsPage from '../pages/SettingsPage';
import ViewLogsPage from '../pages/ViewLogsPage';
import NotFoundPage from '../pages/NotFoundPage';

const AppRoutes: RouteObject[] = [
    {
        path: "/",
        element: <MainLayout />,
        children: [
            {
                path: "/",
                element: <Navigate to="/add-logs" />,
            },
            {
                path: "/add-logs",
                element: <AddLogsPage />,
            },
            {
                path: "/dashboard",
                element: <DashboardPage />,
            },
            {
                path: "/view-logs",
                element: <ViewLogsPage />,
            },
            {
                path: "/anomaly-search",
                element: <AnomaliesPage />,
            },
            {
                path: "/common-patterns",
                element: <CommonPatternsPage />,
            },
            {
                path: "/settings",
                element: <SettingsPage />,
            },
            {
                path: "*",
                element: <NotFoundPage />,
            },
        ]
    },
];

export default AppRoutes;
