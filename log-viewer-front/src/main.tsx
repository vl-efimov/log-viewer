import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './App';
import { Provider } from 'react-redux';
import store from './redux/store';
import { registerSW } from "virtual:pwa-register";
import { ThemeProvider } from './components/ThemeProvider';

import './locales/i18n';
import './styles/theme.css';

const updateSW = registerSW({
	onNeedRefresh () {
		if (confirm("New content available. Reload?")) {
			updateSW(true);
		}
	},
});

ReactDOM.createRoot(document.querySelector("#root")!).render(
	<React.StrictMode>
		<Provider store={store}>
			<ThemeProvider>
				<App />
			</ThemeProvider>
		</Provider>
	</React.StrictMode>
);
