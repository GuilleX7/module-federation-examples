const HtmlWebpackPlugin = require('html-webpack-plugin');
const { VueLoaderPlugin } = require('vue-loader');
const { ModuleFederationPlugin } = require('@module-federation/enhanced');
const { ModuleFederationIsolationPlugin } = require('../plugin');
const path = require('path');

/**
 * @type {import('webpack').Configuration}
 */
const configuration = {
  mode: 'development',
  entry: './src/bootstrap.ts',
  output: {
    clean: true,
    path: __dirname + '/dist',
  },
  target: ['web', 'es2015'],
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.vue$/i,
        use: 'vue-loader',
      },
      {
        test: /\.ts$/i,
        use: [
          {
            loader: 'esbuild-loader',
            options: {
              loader: 'ts',
              target: 'es2015',
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin(),
    new ModuleFederationIsolationPlugin({
      stateStrategy: 'use-origin',
    }),
    new ModuleFederationPlugin({
      name: 'app3',
      filename: 'remoteEntry.js',
      manifest: false,
      shared: ['vue', 'shared-lib', 'shared-lib-2'],
      exposes: {
        '.': './src/index.ts',
      },
      dts: false,
      dev: false,
    }),
  ],
  optimization: {
    // Improve visibility of loaded chunks in the network tab
    minimize: false,
    moduleIds: 'named',
    chunkIds: 'named',
  },
  devtool: false,
  devServer: {
    hot: false,
  },
};

module.exports = configuration;
