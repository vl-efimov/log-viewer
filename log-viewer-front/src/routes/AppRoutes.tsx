import { lazy } from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

import MainLayout from '@/components/AppLayout/AppLayout';
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const LogFormatsPage = lazy(() => import('@/pages/LogFormatsPage'));
const PretrainedModelsPage = lazy(() => import('@/pages/PretrainedModelsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));
const ViewLogsPage = lazy(() => import('@/pages/ViewLogsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
import {
    RouteRoot,
    RouteDashboard,
    RouteViewLogs,
    RouteLogFormats,
    RoutePretrainedModels,
    RouteAbout,
    RouteSettings,
    RouteNotFound
} from '@/routes/routePaths';

/**
 * Application route configuration for the main router.
 */
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
                path: RouteAbout,
                element: <AboutPage />,
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
