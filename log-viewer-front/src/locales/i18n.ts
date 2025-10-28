import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './langs/en.json';
import ru from './langs/ru.json';
import cz from './langs/cz.json';


const savedLanguage = localStorage.getItem('language') || 'en';

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        ru: { translation: ru },
        cz: { translation: cz },
    },
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false,
    },
});

i18n.on('languageChanged', (lng) => {
    localStorage.setItem('language', lng);
});

export default i18n;
