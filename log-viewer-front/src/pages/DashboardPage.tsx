import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';
import NoFileSelected from '../components/NoFileSelected';

const DashboardPage: React.FC = () => {
    const { isMonitoring } = useSelector((state: RootState) => state.logFile);

    if (!isMonitoring) {
        return (
            <NoFileSelected 
                title="Dashboard"
                description="Select a log file to view statistics and analytics."
            />
        );
    }

    return (
        <span>DashboardPage with file analytics coming soon...</span>
    );
}

export default DashboardPage;