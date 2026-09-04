import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pl.obdai.scanner',
  appName: 'OBD AI Scanner',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
