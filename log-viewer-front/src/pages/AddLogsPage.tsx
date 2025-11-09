import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RouteViewLogs } from '../routes/routePaths';
import { RootState } from '../redux/store';
import { useFileLoader } from '../hooks/useFileLoader';
import { FileSelectionView } from '../components/FileSelectionView';
import { MonitoringActiveView } from '../components/MonitoringActiveView';

const AddLogsPage: React.FC = () => {
    const navigate = useNavigate();
    const { isMonitoring, name: fileName } = useSelector((state: RootState) => state.logFile);
    
    const {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
        stopMonitoring,
    } = useFileLoader();

    const handleViewLogs = () => {
        navigate(RouteViewLogs);
    };

    return isMonitoring ? (
        <MonitoringActiveView
            fileName={fileName}
            onViewLogs={handleViewLogs}
            onStopMonitoring={stopMonitoring}
        />
    ) : (
        <FileSelectionView
            indexing={indexing}
            onFileSelect={handleFileSystemAccess}
            onFileInputChange={handleFileInputChange}
        />
    );
}

export default AddLogsPage;