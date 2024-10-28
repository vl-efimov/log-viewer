import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import InputFileUpload from './components/InputFileUpload';

function App () {
  return (
    <Container>
      <Typography variant="h4" component="h1" gutterBottom>
        Hello world
      </Typography>
      <Button variant="contained" color="primary">
        Click
      </Button>
      <InputFileUpload />
    </Container>
  );
}

export default App;
