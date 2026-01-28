import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import fr from "../locales/fr.json";
import nl from "../locales/nl.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import ro from "../locales/ro.json";
import pt from "../locales/pt.json";
import de from "../locales/de.json";
import sq from "../locales/sq.json";
import hu from "../locales/hu.json";
import it from "../locales/it.json";
import zh from "../locales/zh.json";

const resources = {
  fr: { translation: fr },
  nl: { translation: nl },
  en: { translation: en },
  es: { translation: es },
  ro: { translation: ro },
  pt: { translation: pt },
  de: { translation: de },
  sq: { translation: sq },
  hu: { translation: hu },
  it: { translation: it },
  zh: { translation: zh },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "fr",
    supportedLngs: ["fr", "nl", "en", "es", "ro", "pt", "de", "sq", "hu", "it", "zh"],
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "chatslot-language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
