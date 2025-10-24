import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import AppStatusBar from '../components/AppStatusBar';
import { useState, useCallback, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { setLogFile } from '../redux/slices/logFileSlice';
import { addFileWithLogs } from '../utils/logDb';

function detectLogFormat(content: string): string {
    const apacheErrorUniversalRegex = /^\[.*\] \[[a-z]+\](?: \[client [^\]]+\])?(?: .*)?$/m;
    // Apache access log: IP - - [date:time ...] ... "...HTTP/1.1" ...
    // Nginx access log: IP - - [date:time ...] ... "...HTTP/1.1" ...
    // Try to distinguish by request line, referer, user-agent, or other markers
    const apacheAccessRegex = /^\S+ - - \[\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}/m;
    // Nginx: sometimes has HTTP_X_FORWARDED_FOR, or specific user-agent, but not always
    // Try to detect Nginx by presence of "nginx" in user-agent or referer (not reliable, but best effort)
    const nginxAgentRegex = /nginx/i;
    // HDFS v1: 081109 203615 148 INFO dfs.DataNode$PacketResponder: ...
    // Format: yyMMdd HHmmss NNN LEVEL class:
    const hdfsV1Regex = /^\d{6} \d{6} \d+ [A-Z]+ [\w.$:-]+:/m;
    // HDFS v2: 2025-10-21 03:08:18,866 INFO org.apache.hadoop.ipc.Server: ...
    // Format: YYYY-MM-DD HH:MM:SS,mmm LEVEL class: ...
    const hdfsV2Regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} (INFO|WARN|ERROR|DEBUG|TRACE|FATAL) [\w.$:-]+:/m;
    // BGL (старый): ... 2005-06-05-09.39.54.210760 ... (date-time может быть в любой части строки)
    const bglOldRegex = /\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}\.\d{2}\.\d{6}/m;
    // BGL (новый): 2025-10-20 21:37:35 JOB 46082 USER=alice QUEUE=low NODES=128 CORES=256 RUNTIME=00:18:35 STATUS=CANCELLED
    const bglNewRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} JOB \d+ USER=\w+ QUEUE=\w+ NODES=\d+ CORES=\d+ RUNTIME=\d{2}:\d{2}:\d{2} STATUS=\w+/m;
    // Apache: 127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] ...
    // Require username (not '-') after IP
    const apacheRegex = /^\S+ \S+ (?!-)\S+ \[\d{2}\/\w{3}\/\d{4}:/m;
    // Nginx: 127.0.0.1 - - [12/Dec/2020:19:06:43 +0000] ...
    const nginxRegex = /^\S+ - - \[\d{2}\/\w{3}\/\d{4}:/m;
    // Syslog: Oct 11 22:14:15 mymachine su: ...
    const syslogRegex = /^\w{3} +\d{1,2} \d{2}:\d{2}:\d{2} /m;

    const preview = content.split(/\r?\n/).slice(0, 50).join('\n');

    if (apacheErrorUniversalRegex.test(preview)) return 'Apache';
    if (nginxRegex.test(preview)) return 'Nginx';
    if (apacheAccessRegex.test(preview)) {
        const lines = preview.split(/\r?\n/);
        for (const line of lines) {
            if (nginxAgentRegex.test(line)) {
                return 'Nginx';
            }
        }
        return 'Apache';
    }
    if (hdfsV2Regex.test(preview)) return 'HDFS';
    if (hdfsV1Regex.test(preview)) return 'HDFS';
    if (bglNewRegex.test(preview)) return 'BGL';
    if (bglOldRegex.test(preview)) return 'BGL';
    if (apacheRegex.test(preview)) return 'Apache';
    if (syslogRegex.test(preview)) return 'Syslog';
    // If access log format but can't distinguish, fallback to generic
    if (/^\S+ - - \[\d{2}\/\w{3}\/\d{4}:/m.test(preview)) return 'Web Access Log';
    return 'Unknown format';
}
import { Outlet } from 'react-router-dom';


export default function MainLayout () {
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const dispatch = useDispatch();
    const toggleSidebar = () => {
        setSidebarOpen(!isSidebarOpen);
    };

    useEffect(() => {
        const preventDefault = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);
        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
        };
    }, []);

    const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const file = e.dataTransfer.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const content = event.target?.result as string;
                const lines = content.split(/\r?\n/);

                // Detect log format
                const format = detectLogFormat(content);


                // Add file with logs to IndexedDB (pass format)
                const fileId = await addFileWithLogs(file.name, file.size, lines, format);

                // Update Redux state
                dispatch(setLogFile({
                    name: file.name,
                    size: file.size,
                    content,
                    format,
                }));

                // Notify UI that a new file was added so it can become active immediately
                try {
                    window.dispatchEvent(new CustomEvent('logviewer:file-added', { detail: { id: fileId } }));
                } catch {
                    // ignore if CustomEvent isn't supported in environment
                }
            };
            reader.readAsText(file);
        }
    }, [dispatch]);

    const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                border: '1px solid red'
            }}
            onDrop={onDrop}
            onDragOver={onDragOver}
        >
            <CssBaseline />

            <Header
                isSidebarOpen={isSidebarOpen}
                toggleSidebar={toggleSidebar}
            />
            <Box 
                sx={{ 
                    display: 'flex', 
                    flexGrow: 1,
                    overflow: 'hidden',
                    pt: { xs: '56px', sm: '64px' },
                }}
            >
                <Sidebar
                    isSidebarOpen={isSidebarOpen}
                />
                <Box
                    component="main"
                    sx={{
                        flexGrow: 1,
                        overflow: 'hidden',
                        display: 'flex',
                    }}
                >
                    <Box
                        sx={{
                            p: 2,
                            overflow: 'hidden',
                        }}
                    >
                        <Outlet />
                    </Box>
                </Box>
            </Box>
            <AppStatusBar />
        </Box>
    );
}
