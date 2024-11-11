"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModuleFederationIsolationPlugin = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const webpack_1 = require("webpack");
const schema_utils_1 = require("schema-utils");
const satisfies_1 = __importDefault(require("semver/functions/satisfies"));
const PLUGIN_NAME = 'ModuleFederationIsolationPlugin';
var StateStrategy;
(function (StateStrategy) {
    StateStrategy["UseOrigin"] = "use-origin";
    StateStrategy["UseIsolated"] = "use-isolated";
    StateStrategy["UseOwn"] = "use-own";
})(StateStrategy || (StateStrategy = {}));
const PLUGIN_OPTIONS_SCHEMA = {
    type: 'object',
    properties: {
        entry: {
            anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        },
        stateStrategy: {
            type: 'string',
            enum: Object.values(StateStrategy),
        },
        sharedDependencies: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                properties: {
                    stateStrategy: {
                        type: 'string',
                        enum: Object.values(StateStrategy),
                    },
                },
            },
        },
    },
    additionalProperties: false,
};
const instanceStateStrategyPriority = {
    [StateStrategy.UseOrigin]: 0,
    [StateStrategy.UseIsolated]: 10,
    [StateStrategy.UseOwn]: 20,
};
class ModuleFederationIsolationInfoModule extends webpack_1.RuntimeModule {
    constructor(manifest) {
        super('mf isolation runtime', webpack_1.RuntimeModule.STAGE_ATTACH);
        this.manifest = manifest;
    }
    getSizeOptimizedManifest(manifest) {
        const prefixToIndex = {};
        const sizeOptimizedManifest = {
            pre: [],
            pkg: {},
            red: Object.entries(manifest.sharedModuleRedirections).reduce((acc, [moduleId, redirection]) => {
                acc[moduleId] = {
                    mid: redirection.moduleIdToRedirectTo,
                };
                return acc;
            }, {}),
        };
        const rawManifestPrefixes = sizeOptimizedManifest.pre;
        const rawManifestPackages = sizeOptimizedManifest.pkg;
        for (const packageName of Object.keys(manifest.packages)) {
            if (!rawManifestPackages[packageName]) {
                rawManifestPackages[packageName] = {};
            }
            const packageVersions = manifest.packages[packageName];
            for (const version of Object.keys(packageVersions)) {
                const minifiedModulePathToModuleId = {};
                Object.entries(packageVersions[version].modulePathToModuleId).forEach(([modulePath, moduleId]) => {
                    const modulePathNoLoaderNoQuery = modulePath.split(/[!?]/)[0];
                    const lastSlashIndex = modulePathNoLoaderNoQuery.lastIndexOf('/');
                    if (lastSlashIndex === -1) {
                        minifiedModulePathToModuleId[modulePath] = moduleId;
                        return;
                    }
                    const prefix = modulePath.slice(0, lastSlashIndex);
                    const suffix = modulePath.slice(lastSlashIndex + 1);
                    if (!prefixToIndex[prefix]) {
                        prefixToIndex[prefix] = rawManifestPrefixes.length;
                        rawManifestPrefixes.push(prefix);
                    }
                    minifiedModulePathToModuleId[`${prefixToIndex[prefix]}/${suffix}`] = moduleId;
                });
                rawManifestPackages[packageName][version] = [
                    packageVersions[version].semverRangesIn,
                    minifiedModulePathToModuleId,
                ];
            }
        }
        return sizeOptimizedManifest;
    }
    generate() {
        const sizeOptimizedManifest = this.getSizeOptimizedManifest(this.manifest);
        return webpack_1.Template.asString([
            `${webpack_1.RuntimeGlobals.require}.federation = ${webpack_1.RuntimeGlobals.require}.federation || {};`,
            `${webpack_1.RuntimeGlobals.require}.federation.isolation = ${JSON.stringify(sizeOptimizedManifest)};`,
        ]);
    }
}
class ModuleFederationIsolationPlugin {
    constructor(userOptions = {}) {
        this.remoteEntriesToApply = new Set();
        this.remoteEntryIndex = 0;
        (0, schema_utils_1.validate)(PLUGIN_OPTIONS_SCHEMA, userOptions, {
            name: PLUGIN_NAME,
        });
        this.options = {
            // Empty means we apply the plugin to all remote entries
            entry: '',
            stateStrategy: StateStrategy.UseIsolated,
            sharedDependencies: {},
            ...userOptions,
        };
        let maximumInstanceStateStrategyRequired = this.options.stateStrategy;
        for (const sharedDependency of Object.values(this.options.sharedDependencies)) {
            if (instanceStateStrategyPriority[sharedDependency.instanceStateStrategy] >
                instanceStateStrategyPriority[maximumInstanceStateStrategyRequired]) {
                maximumInstanceStateStrategyRequired = sharedDependency.instanceStateStrategy;
            }
        }
        const remoteEntriesToApply = new Set();
        if (this.options.entry) {
            if (typeof this.options.entry === 'string') {
                remoteEntriesToApply.add(this.options.entry);
            }
            else {
                this.options.entry.forEach((entry) => remoteEntriesToApply.add(entry));
            }
        }
    }
    createRuntimePlugin(compiler) {
        const isolationFolderPath = path_1.default.resolve(compiler.context, 'node_modules', '.federation', 'isolation');
        fs_1.default.mkdirSync(isolationFolderPath, { recursive: true });
        const runtimePluginPath = path_1.default.resolve(isolationFolderPath, `mfiruntime${this.remoteEntryIndex}.js`);
        fs_1.default.writeFileSync(runtimePluginPath, webpack_1.Template.asString([
            `const { createMfiRuntimePlugin } = require('${path_1.default.resolve(__dirname, 'ModuleFederationIsolationRuntimePlugin')}');`,
            `module.exports = createMfiRuntimePlugin(${JSON.stringify({
                stateStrategy: this.options.stateStrategy,
                sharedDependencies: this.options.sharedDependencies,
            })});`,
        ]));
        this.remoteEntryIndex++;
        return runtimePluginPath;
    }
    injectRuntimePlugins(compiler) {
        compiler.options.plugins?.forEach((plugin) => {
            if (!plugin) {
                return;
            }
            if (plugin.constructor.name === 'ModuleFederationPlugin') {
                const moduleFederationPlugin = plugin;
                if (!moduleFederationPlugin._options) {
                    return;
                }
                const moduleFederationPluginOptions = moduleFederationPlugin._options;
                const remoteEntryName = moduleFederationPluginOptions.name ?? 'remoteEntry';
                if (!this.remoteEntriesToApply.size || this.remoteEntriesToApply.has(remoteEntryName)) {
                    const runtimePluginPath = this.createRuntimePlugin(compiler);
                    moduleFederationPluginOptions.runtimePlugins =
                        moduleFederationPluginOptions.runtimePlugins || [];
                    moduleFederationPluginOptions.runtimePlugins.push(runtimePluginPath);
                }
            }
        });
    }
    disableConflictingConfiguration(compiler) {
        const originalMangleExports = compiler.options?.optimization?.mangleExports;
        compiler.hooks.afterEnvironment.tap(PLUGIN_NAME, () => {
            // Disable export mangling
            if (compiler.options.optimization.mangleExports !== false) {
                if (originalMangleExports !== undefined) {
                    compiler
                        .getInfrastructureLogger(PLUGIN_NAME)
                        .warn('Export mangling has been disabled to ensure stable export naming');
                }
                compiler.options.optimization.mangleExports = false;
            }
        });
    }
    getPackageJsonPathForModulePath(modulePath) {
        if (!modulePath) {
            return null;
        }
        let currentRelativeDir = path_1.default.dirname(modulePath);
        let packageJsonPath = null;
        while (currentRelativeDir !== '.') {
            const possiblePackageJsonPath = path_1.default.join(currentRelativeDir, 'package.json');
            if (fs_1.default.existsSync(possiblePackageJsonPath)) {
                packageJsonPath = possiblePackageJsonPath;
                break;
            }
            else {
                const nextRelativeDir = path_1.default.dirname(currentRelativeDir);
                if (nextRelativeDir === currentRelativeDir) {
                    break;
                }
                currentRelativeDir = nextRelativeDir;
            }
        }
        return packageJsonPath;
    }
    getPackageInfo(packageJsonPath, packageInfoMap) {
        if (packageInfoMap[packageJsonPath]) {
            return packageInfoMap[packageJsonPath];
        }
        const descriptionFileContent = require(packageJsonPath);
        if (!descriptionFileContent?.name || !descriptionFileContent?.version) {
            return;
        }
        const packageName = descriptionFileContent.name;
        const packageVersion = descriptionFileContent.version;
        const packageDependencies = descriptionFileContent.dependencies || {};
        const packageDevDependencies = descriptionFileContent.devDependencies || {};
        const packagePeerDependencies = descriptionFileContent.peerDependencies || {};
        const notInsightedDependencies = {
            ...packageDependencies,
            ...packageDevDependencies,
            ...packagePeerDependencies,
        };
        packageInfoMap[packageJsonPath] = {
            name: packageName,
            version: packageVersion,
            rangesIn: [],
            notInsightedDependencies,
        };
        return packageInfoMap[packageJsonPath];
    }
    getNormalizedDependencyRange(dependencyRange, packageInfo) {
        if (dependencyRange.startsWith('file:') || dependencyRange.startsWith('link:')) {
            return packageInfo.version;
        }
        if (dependencyRange.startsWith('workspace:')) {
            return dependencyRange.slice('workspace:'.length);
        }
        return dependencyRange;
    }
    tryToInsightDependencies(moduleGraph, module, modulePackageInfo, packageInfoMap) {
        const dependencies = moduleGraph.getOutgoingConnections(module);
        for (const dependency of dependencies) {
            const dependencyModule = dependency.module;
            if (!dependencyModule || dependencyModule.constructor.name !== 'NormalModule') {
                continue;
            }
            const normalModule = dependencyModule;
            const dependencyPackageJsonPath = normalModule.resourceResolveData?.descriptionFilePath;
            if (!dependencyPackageJsonPath) {
                continue;
            }
            const dependencyPackageInfo = this.getPackageInfo(dependencyPackageJsonPath, packageInfoMap);
            if (!dependencyPackageInfo) {
                continue;
            }
            const dependencyRangeSpecifiedInParentModule = modulePackageInfo.notInsightedDependencies[dependencyPackageInfo.name];
            if (dependencyRangeSpecifiedInParentModule) {
                const normalizedDependencyRange = this.getNormalizedDependencyRange(dependencyRangeSpecifiedInParentModule, dependencyPackageInfo);
                if ((0, satisfies_1.default)(dependencyPackageInfo.version, normalizedDependencyRange)) {
                    // If dependency version does not satisfy the range, chances are it's a linked dependency
                    // or the resolution was forced by the user, so we don't want to include a "non used" range
                    dependencyPackageInfo.rangesIn.push(normalizedDependencyRange);
                }
                delete modulePackageInfo.notInsightedDependencies[dependencyPackageInfo.name];
            }
        }
    }
    gatherModuleInfoAndAttachToRuntime(compiler) {
        compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
            const manifest = {
                packages: {},
                sharedModuleRedirections: {},
            };
            const packageInfoByPackageJsonPath = {};
            compilation.hooks.afterOptimizeModuleIds.tap(PLUGIN_NAME, () => {
                compilation.modules.forEach((module) => {
                    const moduleId = compilation.chunkGraph.getModuleId(module);
                    if (moduleId === null) {
                        return;
                    }
                    if (module.constructor.name === 'ConsumeSharedModule') {
                        const referencedModule = compilation.moduleGraph.getModule(module.blocks?.[0]?.dependencies?.[0] || module.dependencies?.[0]);
                        if (!referencedModule || referencedModule.constructor.name !== 'NormalModule') {
                            return;
                        }
                        const referencedModuleId = compilation.chunkGraph.getModuleId(referencedModule);
                        if (referencedModuleId === null) {
                            return;
                        }
                        manifest.sharedModuleRedirections[moduleId] = {
                            moduleIdToRedirectTo: referencedModuleId,
                        };
                        return;
                    }
                    while (module.constructor.name === 'ConcatenatedModule') {
                        module = module.rootModule;
                    }
                    if (module.constructor.name !== 'NormalModule') {
                        return;
                    }
                    const normalModule = module;
                    const moduleFullPath = normalModule.resourceResolveData?.path;
                    if (!moduleFullPath) {
                        return;
                    }
                    const associatedPackageJsonPath = this.getPackageJsonPathForModulePath(moduleFullPath);
                    if (!associatedPackageJsonPath) {
                        return;
                    }
                    const packageInfo = this.getPackageInfo(associatedPackageJsonPath, packageInfoByPackageJsonPath);
                    if (!packageInfo) {
                        return;
                    }
                    this.tryToInsightDependencies(compilation.moduleGraph, normalModule, packageInfo, packageInfoByPackageJsonPath);
                    // We don't want to include modules from the project's package.json
                    if (associatedPackageJsonPath === path_1.default.join(compiler.context, 'package.json')) {
                        return;
                    }
                    let moduleRelativePath = path_1.default.relative(path_1.default.dirname(associatedPackageJsonPath), moduleFullPath);
                    const moduleFullId = normalModule.identifier();
                    if (moduleFullId.includes('!')) {
                        const loaderQuery = normalModule.loaders
                            .map((loader) => {
                            const loaderPackageJsonPath = this.getPackageJsonPathForModulePath(loader.loader);
                            if (!loaderPackageJsonPath) {
                                return null;
                            }
                            const loaderPackageInfo = this.getPackageInfo(loaderPackageJsonPath, packageInfoByPackageJsonPath);
                            if (!loaderPackageInfo) {
                                return null;
                            }
                            const loaderModuleRelativePath = path_1.default.relative(path_1.default.dirname(loaderPackageJsonPath), loader.loader);
                            const loaderOptions = loader.options ? `?${JSON.stringify(loader.options)}` : '!';
                            return `${loaderPackageInfo.name}@${loaderModuleRelativePath}${loaderOptions}`;
                        })
                            .filter(Boolean);
                        // Hint: using question mark instead of exclamation unifies the query string
                        // and allows easier splitting
                        moduleRelativePath = `${moduleRelativePath}?${loaderQuery.join('?')}`;
                    }
                    if (normalModule.resourceResolveData?.query) {
                        // Hint: resourceResolveData.query already begins with a question mark
                        moduleRelativePath += normalModule.resourceResolveData.query;
                    }
                    if (!manifest.packages[packageInfo.name]) {
                        manifest.packages[packageInfo.name] = {};
                    }
                    if (!manifest.packages[packageInfo.name][packageInfo.version]) {
                        manifest.packages[packageInfo.name][packageInfo.version] = {
                            modulePathToModuleId: {},
                            semverRangesIn: [],
                        };
                    }
                    if (manifest.packages[packageInfo.name][packageInfo.version].modulePathToModuleId[moduleRelativePath]) {
                        compiler
                            .getInfrastructureLogger(PLUGIN_NAME)
                            .warn(`Module ${moduleRelativePath} from package ${packageInfo.name}@${packageInfo.version} was found duplicated and will be ignored`);
                        return;
                    }
                    manifest.packages[packageInfo.name][packageInfo.version].modulePathToModuleId[moduleRelativePath] = moduleId;
                });
                Object.values(packageInfoByPackageJsonPath).forEach(({ name, version, rangesIn }) => {
                    const existingEntry = manifest.packages?.[name]?.[version];
                    if (!existingEntry) {
                        return;
                    }
                    existingEntry.semverRangesIn = [
                        ...new Set([...existingEntry.semverRangesIn, ...rangesIn]),
                    ];
                });
            });
            compilation.hooks.afterOptimizeChunkIds.tap(PLUGIN_NAME, (chunks) => {
                for (const chunk of chunks) {
                    if (chunk.hasRuntime() &&
                        (!this.remoteEntriesToApply.size ||
                            (chunk.name && this.remoteEntriesToApply.has(chunk.name)))) {
                        compilation.addRuntimeModule(chunk, new ModuleFederationIsolationInfoModule(manifest));
                    }
                }
            });
        });
    }
    apply(compiler) {
        this.disableConflictingConfiguration(compiler);
        this.injectRuntimePlugins(compiler);
        this.gatherModuleInfoAndAttachToRuntime(compiler);
    }
}
exports.ModuleFederationIsolationPlugin = ModuleFederationIsolationPlugin;
