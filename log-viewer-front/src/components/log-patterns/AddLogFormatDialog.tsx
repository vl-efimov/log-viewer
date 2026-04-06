import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

interface AddLogFormatDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (name: string, description: string, regex: string) => void;
}

const AddLogFormatDialog: React.FC<AddLogFormatDialogProps> = ({ open, onClose, onAdd }) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [regex, setRegex] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleAdd = () => {
        setError(null);
        if (!name.trim() || !regex.trim()) {
            setError('Name and regular expression are required.');
            return;
        }
        let regexValid = true;
        try {
            new RegExp(regex);
        } catch {
            regexValid = false;
        }
        if (!regexValid) {
            setError('Invalid regular expression.');
            return;
        }
        onAdd(name.trim(), description.trim(), regex.trim());
        setName('');
        setDescription('');
        setRegex('');
        setError(null);
    }

    const handleClose = () => {
        setName('');
        setDescription('');
        setRegex('');
        setError(null);
        onClose();
    }

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>Add Custom Log Format</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    label="Name"
                    fullWidth
                    value={name}
                    onChange={e => setName(e.target.value)}
                    sx={{ mb: 2 }}
                />
                <TextField
                    margin="dense"
                    label="Description"
                    fullWidth
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    sx={{ mb: 2 }}
                />
                <TextField
                    margin="dense"
                    label="Regular Expression"
                    fullWidth
                    value={regex}
                    onChange={e => setRegex(e.target.value)}
                    sx={{ mb: 2 }}
                    placeholder={"e.g. ^(?<date>\\d{4}-\\d{2}-\\d{2}) (?<level>\\w+) (?<msg>.+)$"}
                />
                {error && 
                    <Typography
                        color="error"
                        variant="body2"
                        sx={{ mt: 1 }}
                    >
                        {error}
                    </Typography>
                }
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={handleClose}
                    color="secondary"
                >Cancel
                </Button>
                <Button
                    onClick={handleAdd}
                    color="primary"
                    variant="contained"
                >Add
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AddLogFormatDialog;
