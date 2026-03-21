import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { RootState } from '../redux/store';
import { useFileLoader } from '../hooks/useFileLoader';
import { FileSelectionView } from '../components/FileSelectionView';
import { MonitoringActiveView } from '../components/MonitoringActiveView';
import { RouteViewLogs } from '../routes/routePaths';

const AddLogsPage: React.FC = () => {
    const { isMonitoring, name: fileName } = useSelector((state: RootState) => state.logFile);
    const navigate = useNavigate();
    
    const {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
        stopMonitoring,
    } = useFileLoader();


    return isMonitoring ? (
        <MonitoringActiveView
            fileName={fileName}
            onViewLogs={() => navigate(RouteViewLogs)}
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