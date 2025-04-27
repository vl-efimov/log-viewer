import { Languages } from '../constants/LanguagesEnum';

export const loadFlags = async (languages: Languages[]) => {
    const flagCache = new Map<Languages, string>();
    const promises = languages.map(async (language) => {
        try {
            const flagResponse = await import(`../assets/flags/${language}-flag.svg`);
            flagCache.set(language, flagResponse.default);
        } catch (e) {
            console.error(`Error loading flag for ${language}:`, e);
        }
    });

    await Promise.all(promises);
    return flagCache;
};
