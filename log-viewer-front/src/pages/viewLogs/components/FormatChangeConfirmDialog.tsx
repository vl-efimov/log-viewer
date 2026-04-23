import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import WarningIcon from '@mui/icons-material/Warning';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface FormatChangeConfirmDialogProps {
    open: boolean;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const FormatChangeConfirmDialog: React.FC<FormatChangeConfirmDialogProps> = ({
    open,
    message,
    onConfirm,
    onCancel,
}) => (
    <Dialog
        open={open}
        onClose={onCancel}
        maxWidth="sm"
        fullWidth
        PaperProps={{
            sx: {
                maxWidth: 520,
            },
        }}
    >
        <DialogContent sx={{ pt: 4, position: 'relative' }}>
            <IconButton
                aria-label="close"
                onClick={onCancel}
                size="small"
                sx={{ position: 'absolute', right: 8, top: 8 }}
            >
                <CloseIcon fontSize="small" />
            </IconButton>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <WarningIcon color="warning" sx={{ mt: 0.5 }} />
                <Typography variant="body1">
                    {message}
                </Typography>
            </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={onCancel} variant="outlined">
                Отмена
            </Button>
            <Button onClick={onConfirm} variant="contained" autoFocus>
                OK
            </Button>
        </DialogActions>
    </Dialog>
);

export default FormatChangeConfirmDialog;
