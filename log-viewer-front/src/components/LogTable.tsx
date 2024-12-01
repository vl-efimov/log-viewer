import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../redux/store';
import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Typography } from '@mui/material';

const LogTable: React.FC = () => {
    const fileContent = useSelector((state: RootState) => state.file.data);
    if (!fileContent) {
        return (
            <Typography variant="h6" sx={{ padding: 2 }}>
                No file content available. Please upload a file.
            </Typography>
        );
    }

    const rows = fileContent.split('\n').map((line) => line.split('|'));

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
