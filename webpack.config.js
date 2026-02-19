const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: {
      background: './src/background/index.ts',
      popup: './src/popup/index.tsx',
      options: './src/options/index.tsx',
      content: './src/content/index.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      chunkFilename: '[name].chunk.js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.(png|jpg|jpeg|gif|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: 'assets/[name][ext]',
          },
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.jsx'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@services': path.resolve(__dirname, 'src/services'),
        '@utils': path.resolve(__dirname, 'src/utils'),
        '@types': path.resolve(__dirname, 'src/types'),
        '@store': path.resolve(__dirname, 'src/store'),
      },
    },
    plugins: [
      new CleanWebpackPlugin(),
      new HtmlWebpackPlugin({
        template: './src/popup/index.html',
        filename: 'popup.html',
        chunks: ['popup'],
      }),
      new HtmlWebpackPlugin({
        template: './src/options/index.html',
        filename: 'options.html',
        chunks: ['options'],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'manifest.json',
            to: 'manifest.json',
            transform(content) {
              const manifest = JSON.parse(content.toString());
              // Update paths for development
              if (!isProduction) {
                manifest.name = `${manifest.name} (Dev)`;
              }
              // Remove dist/ prefix from manifest paths since we're copying to dist
              manifest.background.service_worker = 'background.js';
              manifest.options_page = 'options.html';
              manifest.content_scripts[0].js = ['content.js'];
              manifest.web_accessible_resources[0].resources = ['*.js', '*.css', '*.html', '*.map', 'icons/*.png'];
              return JSON.stringify(manifest, null, 2);
            },
          },
          {
            from: 'icons',
            to: 'icons',
          },
          {
            from: 'privacy-policy.html',
            to: 'privacy-policy.html',
          },
          {
            from: 'help.html',
            to: 'help.html',
          },
        ],
      }),
    ],
    devtool: isProduction ? false : 'inline-source-map',
    optimization: {
      minimize: isProduction,
      splitChunks: {
        chunks(chunk) {
          // Don't split chunks for background script - it needs to be a single file
          return chunk.name !== 'background' && chunk.name !== 'content';
        },
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            priority: 10,
            reuseExistingChunk: true,
            enforce: true,
            chunks(chunk) {
              return chunk.name !== 'background' && chunk.name !== 'content';
            },
          },
          mui: {
            test: /[\\/]node_modules[\\/]@mui[\\/]/,
            name: 'mui',
            priority: 20,
            reuseExistingChunk: true,
            chunks(chunk) {
              return chunk.name !== 'background' && chunk.name !== 'content';
            },
          },
          crypto: {
            test: /[\\/]node_modules[\\/]crypto-js[\\/]/,
            name: 'crypto',
            priority: 15,
            reuseExistingChunk: true,
            chunks(chunk) {
              return chunk.name !== 'background' && chunk.name !== 'content';
            },
          },
          common: {
            minChunks: 2,
            priority: 5,
            reuseExistingChunk: true,
            chunks(chunk) {
              return chunk.name !== 'background' && chunk.name !== 'content';
            },
          },
        },
      },
      runtimeChunk: {
        name: (entrypoint) => (entrypoint.name !== 'background' && entrypoint.name !== 'content') ? 'runtime' : false,
      },
      usedExports: true,
      sideEffects: false,
    },
    performance: {
      hints: false,
      maxEntrypointSize: 512000,
      maxAssetSize: 512000,
    },
  };
};