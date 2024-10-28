import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';

function App () {
  return (
    <Container>
      <Typography variant="h4" component="h1" gutterBottom>
        Hello world
      </Typography>
      <Button variant="contained" color="primary">
        Click
      </Button>
    </Container>
  );
}

export default App;
