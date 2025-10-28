import { Navigate, RouteObject } from 'react-router-dom';

import MainLayout from '../layouts/MainLayout';
import AddLogsPage from '../pages/AddLogsPage';
import AnomaliesPage from '../pages/AnomaliesPage';
import CommonPatternsPage from '../pages/CommonPatternsPage';
import DashboardPage from '../pages/DashboardPage';
import SettingsPage from '../pages/SettingsPage';
import ViewLogsPage from '../pages/ViewLogsPage';
import NotFoundPage from '../pages/NotFoundPage';
import {
    RouteRoot,
    RouteAddLogs,
    RouteDashboard,
    RouteViewLogs,
    RouteAnomalySearch,
    RouteCommonPatterns,
    RouteSettings,
    RouteNotFound
} from './routePaths';

const AppRoutes: RouteObject[] = [
    {
        path: RouteRoot,
        element: <MainLayout />,
        children: [
            {
                path: RouteRoot,
                element: <Navigate to={RouteAddLogs} />,
            },
            {
                path: RouteAddLogs,
                element: <AddLogsPage />,
            },
            {
                path: RouteDashboard,
                element: <DashboardPage />,
            },
            {
                path: RouteViewLogs,
                element: <ViewLogsPage />,
            },
            {
                path: RouteAnomalySearch,
                element: <AnomaliesPage />,
            },
            {
                path: RouteCommonPatterns,
                element: <CommonPatternsPage />,
            },
            {
                path: RouteSettings,
                element: <SettingsPage />,
            },
            {
                path: RouteNotFound,
                element: <NotFoundPage />,
            },
        ]
    },
];

export default AppRoutes;
