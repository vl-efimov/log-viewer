import { Navigate, RouteObject } from 'react-router-dom';

import MainLayout from '../components/AppLayout/AppLayout';
import DashboardPage from '../pages/DashboardPage';
import LogFormatsPage from '../pages/LogFormatsPage';
import PretrainedModelsPage from '../pages/PretrainedModelsPage';
import SettingsPage from '../pages/SettingsPage';
import ViewLogsPage from '../pages/ViewLogsPage';
import NotFoundPage from '../pages/NotFoundPage';
import {
    RouteRoot,
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
                element: <Navigate to={RouteViewLogs} />,
            },
            {
                path: RouteViewLogs,
                element: <ViewLogsPage />,
            },
            {
                path: RouteDashboard,
                element: <DashboardPage />,
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
