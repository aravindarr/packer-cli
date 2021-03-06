import path from 'path';
import handlebars from 'handlebars';
import glob from 'glob-to-regexp';
import chalk from 'chalk';

import { rollup, RollupFileOptions } from 'rollup';
import rollupIgnoreImport from 'rollup-plugin-ignore-import';
import rollupPostCss from 'rollup-plugin-postcss';
import postCssImageInline from 'postcss-image-inliner';
import postCssAutoPrefix from 'autoprefixer';
import rollupReplace from 'rollup-plugin-re';
import rollupIgnore from 'rollup-plugin-ignore';
import rollupResolve from 'rollup-plugin-node-resolve';
import rollupCommonjs from 'rollup-plugin-commonjs';
import rollupTypescript from 'rollup-plugin-typescript2';
import rollupBabel from 'rollup-plugin-babel';
import rollupHandlebars from 'rollup-plugin-hbs';
import rollupImage from 'rollup-plugin-img';
import rollupProgress from 'rollup-plugin-progress';
import rollupFilesize from 'rollup-plugin-filesize';
import rollupBuiltins from 'rollup-plugin-node-builtins';
import rollupGlobals from 'rollup-plugin-node-globals';
import rollupJson from 'rollup-plugin-json';

import { meta } from './meta';
import { PackageConfig } from '../model/package-config';
import { PackerConfig } from '../model/packer-config';
import logger, { Logger } from '../common/logger';
import { LogLevel } from '../model/log-level';

export const getBanner = (config: PackerConfig, packageJson: PackageConfig) => {
  if (config.license.banner) {
    const bannerTemplate = meta.readBannerTemplate();
    return handlebars.compile(bannerTemplate)({
      config,
      pkg: packageJson
    });
  }
};

export const rollupOnWarn = (task: string, type: string) => {
  return (warning, warn) => {
    const customWarn = {
      ...warning,
      message: chalk.green(task) + ' ' + chalk.yellow(`${type} bundle: ${warning}`)
    };

    warn(customWarn);
  };
};

export const getBaseConfig = (config: PackerConfig, packageJson: PackageConfig, banner: string) => {
  return {
    input: path.join(config.source, config.entry),
    output: {
      banner,
      name: packageJson.name,
      sourcemap: config.output.sourceMap
    }
  };
};

export const rollupStyleBuildPlugin = (config: PackerConfig,
                                       packageJson: PackageConfig,
                                       watch: boolean,
                                       minify: boolean,
                                       main: boolean) => {
  const styleDir = watch ? path.join(config.tmp, 'watch') : config.dist;
  const fileName = packageJson.name + (minify ? '.min.css' : '.css');
  const styleDist = path.join(process.cwd(), styleDir, config.output.stylesDir, fileName);

  if (!main && !config.output.inlineStyle) {
    return rollupIgnoreImport({
      extensions: ['.scss', '.sass', '.styl', '.css', '.less']
    });
  }

  return rollupPostCss({
    extract: config.output.inlineStyle ? false : styleDist,
    minimize: minify,
    plugins: [
      postCssImageInline({
        assetPaths: config.assetPaths,
        maxFileSize: config.output.imageInlineLimit
      }),
      postCssAutoPrefix
    ],
    sourceMap: config.output.sourceMap
  });
};

export const rollupReplacePlugin = (config: PackerConfig) => {
  return rollupReplace({
    patterns: config.replacePatterns
  });
};

export const resolvePlugins = (config: PackerConfig) => {
  const plugins = [
    rollupIgnore(config.ignore),
    rollupResolve({
      browser: true,
      jsnext: true,
      main: true,
      preferBuiltins: false
    }),
    rollupCommonjs({
      include: 'node_modules/**'
    }),
    rollupJson()
  ];

  if (config.compiler.buildMode === 'browser') {
    plugins.push(
      rollupGlobals(),
      rollupBuiltins()
    );
  }

  return plugins;
};

export const buildPlugin = (packageModule: string, generateDefinition: boolean, check: boolean, config: PackerConfig,
                            tsPackage: boolean) => {
  const plugins = [];
  if (config.compiler.scriptPreprocessor  === 'typescript') {
    const buildConf: any = {
      check,
      tsconfig: `tsconfig.json`,
      typescript: tsPackage,
      clean: config.compiler.concurrentBuild,
      cacheRoot: path.join(process.cwd(), config.tmp, '.rts2_cache')
    };

    if (generateDefinition) {
      buildConf.tsconfigOverride = {
        compilerOptions: {
          declaration: true,
          declarationDir: path.join(process.cwd(), config.dist)
        }
      };

      buildConf.useTsconfigDeclarationDir = true;
    }

    plugins.push(rollupTypescript(buildConf));
  }

  const babelConfig = meta.readBabelConfig(packageModule);
  plugins.push(rollupBabel({
    babelrc: false,
    exclude: 'node_modules/**',
    extensions: [ '.js', '.jsx', '.es6', '.es', '.mjs', '.ts', '.tsx' ],
    plugins: babelConfig.plugins || [],
    presets: babelConfig.presets || [],
    runtimeHelpers: true
  }));

  return plugins;
};

export const preBundlePlugins = (config: PackerConfig) => {
  return [
    rollupReplacePlugin(config),
    rollupHandlebars(),
    rollupImage({
      exclude: 'node_modules/**',
      extensions: /\.(png|jpg|jpeg|gif|svg)$/,
      limit: config.output.imageInlineLimit
    })
  ];
};

export const postBundlePlugins = (task: string, type: string) => {
  if (logger.level <= LogLevel.INFO) {
    return [
      rollupProgress(),
      rollupFilesize({
        render: (options, size, gzippedSize) => {
          return chalk.yellow(
            `${chalk.green(task)} ${type} bundle size: ${chalk.red(size)}, gzipped size: ${chalk.red(gzippedSize)}`);
        }
      })
    ];
  }

  return [];
};

export const bundleBuild = async (config: RollupFileOptions, type: string, log: Logger): Promise<void> => {
  log.trace('%s bundle build start', type);
  const bundle = await rollup(config);
  await bundle.write(config.output);
  log.trace('%s bundle build end', type);
};

export const externalFilter = (config: PackerConfig) => {
  const filter = config.bundle.externals.map((external) => glob(external));
  return (id: string) => {
    return filter.some((include) => include.test(id));
  };
};

export const extractBundleExternals = (config: PackerConfig) => {
  return config.bundle.mapExternals ? Object.keys(config.bundle.globals) : externalFilter(config);
};
