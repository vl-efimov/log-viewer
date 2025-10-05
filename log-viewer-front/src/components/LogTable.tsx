import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

const LogTable: React.FC = () => {
    const fileContent = useSelector((state: RootState) => state.file.data);
    if (!fileContent) {
        return (
            <Typography variant="h6" sx={{ padding: 2 }}>
                No file content available. Please upload a file.
            </Typography>
        );
    }

    const rows = fileContent.split('\n').map((line: string) => line.split('|'));

    return (
        <Box>
            <Typography variant="h6">Log Data</Typography>
            <TableContainer
                component={Paper}
                sx={{
                    marginTop: 2
                }}
            >
                <Table>
                    <TableHead>
                        <TableRow>
                            {rows[0].map((column, index) => (
                                <TableCell key={index}>{column.trim()}</TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.slice(1).map((row, rowIndex) => (
                            <TableRow key={rowIndex}>
                                {row.map((cell, cellIndex) => (
                                    <TableCell key={cellIndex}>{cell.trim()}</TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default LogTable;
