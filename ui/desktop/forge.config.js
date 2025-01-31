const { VitePlugin } = require('@electron-forge/plugin-vite');
const { AutoUnpackNativesPlugin } = require('@electron-forge/plugin-auto-unpack-natives');

module.exports = {
  packagerConfig: {
    name: 'Goose',
    executableName: 'Goose',
    asar: true,
    icon: './src/images/icon',
    extraResource: './app-update.yml'
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Goose',
        setupIcon: './src/images/icon.ico',
        authors: 'Goose Team'
      }
    }
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // Single build source
      build: [
        {
          // Main process entry point
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          // Renderer process entry point
          entry: 'src/renderer.tsx',
          config: 'vite.renderer.config.ts',
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        }
      ]
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
