import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';

export default {
  packagerConfig: {
    name: 'Goose',
    executableName: 'Goose',
    asar: true,
    icon: './src/images/icon',
    extraResource: './app-update.yml',
    platform: ['win32']
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'Goose',
        setupIcon: './src/images/icon.ico'
      }
    }
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [{
        entry: 'src/main.ts',
        config: 'vite.main.config.ts',
      }, {
        entry: 'src/renderer.tsx',
        config: 'vite.renderer.config.ts',
      }],
    })
  ],
  hooks: {
    packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
      const fs = require('fs');
      const path = require('path');
      
      // Copy app-update.yml to resources directory
      const appUpdatePath = path.resolve(__dirname, 'app-update.yml');
      const resourcesPath = path.join(buildPath, 'resources');
      
      if (fs.existsSync(appUpdatePath)) {
        if (!fs.existsSync(resourcesPath)) {
          fs.mkdirSync(resourcesPath, { recursive: true });
        }
        fs.copyFileSync(appUpdatePath, path.join(resourcesPath, 'app-update.yml'));
      }
    }
  }
};
