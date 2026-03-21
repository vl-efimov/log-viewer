import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';
import { useFileLoader } from '../hooks/useFileLoader';
import { FileSelectionView } from '../components/FileSelectionView';
import { MonitoringActiveView } from '../components/MonitoringActiveView';

const AddLogsPage: React.FC = () => {
    const { isMonitoring, name: fileName } = useSelector((state: RootState) => state.logFile);
    
    const {
        indexing,
        handleFileInputChange,
        handleFileSystemAccess,
        stopMonitoring,
    } = useFileLoader();


    return isMonitoring ? (
        <MonitoringActiveView
            fileName={fileName}
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