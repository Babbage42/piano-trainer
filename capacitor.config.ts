import type { CapacitorConfig } from '@capacitor/cli';

// L'app iPhone : la même app web, emballée par Capacitor, avec un module natif pour le MIDI
// (l'iPhone n'a pas de Web MIDI). Voir ios/App/App/MidiPlugin.swift.
const config: CapacitorConfig = {
  appId: 'io.github.babbage42.pianotrainer',
  appName: 'Piano',
  webDir: 'dist',
  ios: {
    // L'app occupe tout l'écran, encoche comprise : la page gère les marges (safe-area).
    contentInset: 'never',
  },
  plugins: {
    // Les requêtes vers Mutopia passent par le réseau natif, sans la limite CORS du navigateur.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
