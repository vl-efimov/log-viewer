import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import PaletteIcon from '@mui/icons-material/Palette';
import CloseIcon from '@mui/icons-material/Close';
import LanguageSelect from '../../common/LanguageSelect';
import { useTranslation } from 'react-i18next';
import { useState, useContext } from 'react';
import { ThemeContext } from '../../../contexts/ThemeContext';
import ThemePaletteDrawer from '../ThemePaletteDrawer';
import ThemeToggleButton from '../../common/ThemeToggleButton';
import Box from '@mui/material/Box';
import { ColorModeEnum } from '../../../constants/ColorModeEnum';
import { RootState } from '../../../redux/store';
import { useDispatch, useSelector } from 'react-redux';
import Tooltip from '@mui/material/Tooltip';
import { clearLogFile, setFileHandle, setFileObject } from '../../../redux/slices/logFileSlice';
import { clearAnomalyResults, requestAnomalyCancel } from '../../../redux/slices/anomalySlice';
import { deleteAllLogData } from '../../../utils/logIndexedDb';
import { cancelIndexing } from '../../../utils/logIndexer';
import {
    cancelActiveRemoteUploadSession,
    cancelBglAnomalyPrediction,
    deleteRemoteIngest,
} from '../../../services/bglAnomalyApi';

import {
    appBarSx,
    toolbarSx,
    menuBoxSx,
    iconButtonSx,
    titleSx,
    rightGroupSx,
    langBoxSx,
    headerLeftSx,
    titleRowSx,
    fileBadgeWrapSx,
    fileBadgeSx,
    fileClearButtonSx,
    fileBadgeSpacerSx,
} from './styles';

interface HeaderProps {
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
}

const Header: React.FC<HeaderProps> = ({ isSidebarOpen, toggleSidebar }) => {
    const { i18n } = useTranslation();
    const dispatch = useDispatch();
    const themeCtx = useContext(ThemeContext);
    if (!themeCtx) return null;
    const { toggleTheme, mode, primaryColor, setPrimaryColor } = themeCtx;
    const [drawerOpen, setDrawerOpen] = useState(false);

    const textColor = mode === ColorModeEnum.Light ? '#fff' : undefined;

    const { name: fileName, analyticsSessionId } = useSelector((state: RootState) => state.logFile);
    const { isRunning: anomalyIsRunning, runningModelId: anomalyRunningModelId, lastModelId: anomalyLastModelId } = useSelector((state: RootState) => state.anomaly);

    const handleClearFile = async () => {
        const pendingUploadIngestId = cancelActiveRemoteUploadSession();

        if (anomalyIsRunning) {
            dispatch(requestAnomalyCancel());
            const modelId = anomalyRunningModelId ?? anomalyLastModelId ?? 'bgl';
            try {
                await cancelBglAnomalyPrediction(modelId);
            } catch (error) {
                console.error('Failed to cancel anomaly prediction:', error);
            }
        }

        const remoteIngestId = analyticsSessionId.startsWith('remote:')
            ? analyticsSessionId.slice('remote:'.length)
            : null;

        const ingestIdsToDelete = Array.from(new Set([
            remoteIngestId,
            pendingUploadIngestId,
        ].filter((value): value is string => Boolean(value))));

        for (const ingestId of ingestIdsToDelete) {
            try {
                await deleteRemoteIngest(ingestId);
            } catch (error) {
                console.error('Failed to delete remote ingest data:', error);
            }
        }

        dispatch(clearLogFile());
        dispatch(clearAnomalyResults());
        setFileHandle(null);
        setFileObject(null);
        if (analyticsSessionId) {
            cancelIndexing(analyticsSessionId);
        }
        await deleteAllLogData();
    };

    return (
        <AppBar sx={appBarSx}>
            <Toolbar sx={toolbarSx}>
                <Box sx={headerLeftSx(isSidebarOpen)}>
                    <Box sx={menuBoxSx}>
                        <IconButton
                            sx={iconButtonSx(textColor)}
                            aria-label="menu"
                            onClick={toggleSidebar}
                        >
                            {isSidebarOpen ? <MenuOpenIcon /> : <MenuIcon />}
                        </IconButton>
                    </Box>

                    <Box sx={titleRowSx}>
                        <Typography
                            sx={titleSx(textColor)}
                            variant="h6"
                        >
                            {i18n.t('appTitle')}
                        </Typography>
                    </Box>
                </Box>

                {fileName ? (
                    <Box sx={fileBadgeWrapSx}>
                        <Paper sx={fileBadgeSx}>
                            <Typography sx={{...titleSx(textColor)}}>
                                {fileName}
                            </Typography>
                            <Tooltip
                                title="Close current file and stop monitoring"
                                arrow
                                placement="top"
                            >
                                <IconButton
                                    onClick={handleClearFile}
                                    size="small"
                                    sx={fileClearButtonSx(textColor)}
                                >
                                    <CloseIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Paper>
                    </Box>
                ) : (<Box sx={fileBadgeSpacerSx}></Box>)}

                <Box sx={rightGroupSx}>
                    <ThemeToggleButton
                        mode={mode}
                        toggleTheme={toggleTheme}
                    />
                    <IconButton
                        sx={iconButtonSx(textColor)}
                        aria-label="theme palette"
                        onClick={() => setDrawerOpen(true)}
                    >
                        <PaletteIcon />
                    </IconButton>
                    <Box sx={langBoxSx(textColor)}>
                        <LanguageSelect />
                    </Box>
                </Box>
            </Toolbar>
            <ThemePaletteDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                onPrimaryChange={setPrimaryColor}
                currentPrimary={primaryColor}
                mode={mode}
                onThemeToggle={toggleTheme}
            />
        </AppBar>
    );
}

export default Header;
