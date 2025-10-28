import { Navigate, RouteObject } from 'react-router-dom';

import MainLayout from '../layouts/MainLayout';
import AddLogsPage from '../pages/AddLogsPage';
import LogFormatsPage from '../pages/LogFormatsPage';
import PretrainedModelsPage from '../pages/PretrainedModelsPage';
import DashboardPage from '../pages/DashboardPage';
import SettingsPage from '../pages/SettingsPage';
import ViewLogsPage from '../pages/ViewLogsPage';
import NotFoundPage from '../pages/NotFoundPage';
import {
    RouteRoot,
    RouteHome,
    RouteDashboard,
    RouteViewLogs,
    RouteLogFormats,
    RoutePretrainedModels,
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
                element: <Navigate to={RouteHome} />,
            },
            {
                path: RouteHome,
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
                path: RouteLogFormats,
                element: <LogFormatsPage />,
            },
            {
                path: RoutePretrainedModels,
                element: <PretrainedModelsPage />,
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
