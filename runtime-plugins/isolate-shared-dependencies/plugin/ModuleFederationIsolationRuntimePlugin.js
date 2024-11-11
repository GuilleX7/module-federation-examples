"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMfiRuntimePlugin = void 0;
const satisfies_1 = __importDefault(require("semver/functions/satisfies"));
const PLUGIN_NAME = 'ModuleFederationIsolationPlugin';
function patchModuleFactory(moduleFactory, patchedRequire) {
    return new Proxy(moduleFactory, {
        apply(target, thisArg, args) {
            const [moduleArg, exportsArg] = args;
            return target.apply(thisArg, [moduleArg, exportsArg, patchedRequire]);
        },
    });
}
function initiateRuntimeManifestIfPresent(ownRequire) {
    if (!ownRequire.federation.isolation || ownRequire.federation.isolation.initiated) {
        return;
    }
    const manifest = ownRequire.federation.isolation;
    manifest.initiated = true;
    manifest.midToUid = {};
    manifest.pkgVersions = {};
    manifest.pkgMatch = {};
    const { pre, pkg, midToUid, pkgVersions } = manifest;
    Object.entries(pkg).forEach(([packageName, packageVersions]) => {
        Object.entries(packageVersions).forEach(([packageVersion, packageData]) => {
            if (!pkgVersions[packageName]) {
                pkgVersions[packageName] = [];
            }
            pkgVersions[packageName].push([packageVersion, packageData[0]]);
            Object.entries(packageData[1]).forEach(([modulePath, moduleId]) => {
                let modulePathNoLoaderNoQuery = modulePath;
                const firstQuestionMarkIndex = modulePath.indexOf('?');
                if (firstQuestionMarkIndex !== -1) {
                    modulePathNoLoaderNoQuery = modulePath.slice(0, firstQuestionMarkIndex);
                }
                const firstSlashIndex = modulePathNoLoaderNoQuery.indexOf('/');
                if (firstSlashIndex !== -1) {
                    delete packageData[1][modulePath];
                    const preffix = modulePath.slice(0, firstSlashIndex);
                    const suffix = modulePath.slice(firstSlashIndex + 1);
                    modulePath = `${pre[parseInt(preffix)]}/${suffix}`;
                    packageData[1][modulePath] = moduleId;
                }
                midToUid[moduleId] = { pkgName: packageName, pkgVersion: packageVersion, modulePath };
            });
        });
    });
}
function updateSharedModuleRedirections(runtimeManifest, pkgName, pkgVersion, newRedirection) {
    Object.entries(runtimeManifest.red).forEach(([moduleId, redirectionData]) => {
        if (!redirectionData || redirectionData.originRequire) {
            return;
        }
        const { pkgName: redirectionPkgName, pkgVersion: redirectionPkgVersion } = runtimeManifest.midToUid[redirectionData.mid];
        if (redirectionPkgName === pkgName && redirectionPkgVersion === pkgVersion) {
            runtimeManifest.red[moduleId] = newRedirection;
        }
    });
}
function createIsolationRequire(ownRequire, originalOriginRequire, isolationNamespace) {
    return new Proxy(originalOriginRequire, {
        apply(_, thisArg, args) {
            let [originModuleId] = args;
            let originRequire = originalOriginRequire;
            // If module is a consume shared module, redirect to the real module and host
            const possibleRedirection = originRequire.federation.isolation.red[originModuleId];
            if (possibleRedirection) {
                originModuleId = possibleRedirection.mid;
                originRequire = possibleRedirection.originRequire ?? originRequire;
            }
            const isolatedModuleId = `${isolationNamespace}/${originModuleId}`;
            if (ownRequire.c[isolatedModuleId]) {
                // Module is already instantiated and copied to the own cache
                return ownRequire.c[isolatedModuleId].exports;
            }
            if (originRequire.c[isolatedModuleId]) {
                // Module is still instantiating in the originRequire cache
                return originRequire.c[isolatedModuleId].exports;
            }
            // Module is not in cache, create a new module instance
            originRequire.m[isolatedModuleId] = patchModuleFactory(originRequire.m[originModuleId], createIsolationRequire(ownRequire, originRequire, isolationNamespace));
            originRequire.apply(thisArg, [isolatedModuleId]);
            // Move instantiated module and clean up the origin cache
            ownRequire.c[isolatedModuleId] = originRequire.c[isolatedModuleId];
            if (ownRequire !== originRequire) {
                delete originRequire.c[isolatedModuleId];
                delete originRequire.m[isolatedModuleId];
            }
            return ownRequire.c[isolatedModuleId].exports;
        },
    });
}
function createTranslationRequire(ownRequire, originalOriginRequire, isolationNamespace) {
    return new Proxy(originalOriginRequire, {
        apply(_, thisArg, args) {
            let [originModuleId] = args;
            let originRequire = originalOriginRequire;
            // If module is a consume shared module, redirect to the real module and host
            const possibleRedirection = originRequire.federation.isolation.red[originModuleId];
            if (possibleRedirection) {
                originModuleId = possibleRedirection.mid;
                originRequire = possibleRedirection.originRequire ?? originRequire;
            }
            let ownModuleId = undefined;
            const originUniversalModule = originRequire.federation.isolation.midToUid[originModuleId];
            if (originUniversalModule) {
                const originPackageUniversalId = `${originUniversalModule.pkgName}~${originUniversalModule.pkgVersion}`;
                const originHostName = originRequire.federation.isolation.hostName;
                let ownPackageVersion = ownRequire.federation.isolation.pkgMatch[originHostName]?.[originPackageUniversalId];
                if (ownPackageVersion === undefined) {
                    ownPackageVersion =
                        ownRequire.federation.isolation.pkgVersions[originUniversalModule.pkgName]?.find(([, rangesIn]) => rangesIn.every((range) => (0, satisfies_1.default)(originUniversalModule.pkgVersion, range)))?.[0] ?? null;
                    ownRequire.federation.isolation.pkgMatch[originHostName] = {
                        ...(ownRequire.federation.isolation.pkgMatch[originHostName] || {}),
                        [originPackageUniversalId]: ownPackageVersion,
                    };
                }
                if (ownPackageVersion !== null) {
                    ownModuleId =
                        ownRequire.federation.isolation.pkg[originUniversalModule.pkgName][ownPackageVersion][1][originUniversalModule.modulePath];
                }
            }
            if (ownModuleId && ownRequire.c[ownModuleId]) {
                // Module is already instantiated and copied to the own cache
                return ownRequire.c[ownModuleId].exports;
            }
            const isolatedModuleId = `${isolationNamespace}/${originModuleId}`;
            ownModuleId = ownModuleId ?? isolatedModuleId;
            if (originRequire.c[isolatedModuleId]) {
                // Module is still instantiating in the originRequire cache
                return originRequire.c[isolatedModuleId].exports;
            }
            // Module is not in cache, create a new module instance
            originRequire.m[isolatedModuleId] = patchModuleFactory(originRequire.m[originModuleId], createTranslationRequire(ownRequire, originRequire, isolationNamespace));
            originRequire.apply(thisArg, [isolatedModuleId]);
            // Move instantiated module and clean up the origin cache
            ownRequire.c[ownModuleId] = originRequire.c[isolatedModuleId];
            if (ownRequire !== originRequire) {
                delete originRequire.c[isolatedModuleId];
                delete originRequire.m[isolatedModuleId];
            }
            return ownRequire.c[ownModuleId].exports;
        },
    });
}
function createMfiRuntimePlugin(options) {
    return function plugin() {
        const ownRequire = __webpack_require__;
        initiateRuntimeManifestIfPresent(ownRequire);
        return {
            name: 'ModuleFederationIsolationRuntimePlugin',
            version: '2.0.0',
            beforeInit: (args) => {
                const ownHost = args.origin;
                // Expose the __webpack_require__ function in the federation host
                if (!ownHost.__webpack_require__) {
                    ownHost.__webpack_require__ = ownRequire;
                }
                else if (ownHost.__webpack_require__ !== ownRequire) {
                    console.warn(`[${PLUGIN_NAME}] The __webpack_require__ function of the host ${ownHost.name} is already set. This may lead to unexpected behavior.`);
                }
                // Save the host name in the manifest
                ownRequire.federation.isolation.hostName = ownHost.name;
                return args;
            },
            resolveShare: (args) => {
                const pkgName = args.pkgName;
                const pkgVersion = args.version;
                let stateStrategy = options.stateStrategy;
                if (options.sharedDependencies[pkgName]) {
                    stateStrategy = options.sharedDependencies[pkgName].stateStrategy;
                }
                const resolvedDependency = args.resolver();
                if (!resolvedDependency) {
                    return args;
                }
                args.resolver = () => ({
                    ...resolvedDependency,
                    scope: [ownRequire.federation.isolation.hostName],
                    lib: undefined,
                    loaded: false,
                    loading: Promise.resolve()
                        .then(() => resolvedDependency.get())
                        .then((originalFactory) => {
                        // Mark the original factory as loaded
                        resolvedDependency.lib = originalFactory;
                        resolvedDependency.loaded = true;
                        return originalFactory;
                    })
                        .then((originalFactory) => {
                        const originHost = args.GlobalFederation.__INSTANCES__.find((instance) => instance.name === resolvedDependency.from);
                        if (!originHost) {
                            console.warn(`[${PLUGIN_NAME}] Could not find host named ${resolvedDependency.from}`);
                            updateSharedModuleRedirections(ownRequire.federation.isolation, pkgName, pkgVersion, null);
                            return originalFactory;
                        }
                        else if (!originHost.__webpack_require__) {
                            console.warn(`[${PLUGIN_NAME}] Host ${resolvedDependency.from} is not using ${PLUGIN_NAME}`);
                            updateSharedModuleRedirections(ownRequire.federation.isolation, pkgName, pkgVersion, null);
                            return originalFactory;
                        }
                        const originRequire = originHost.__webpack_require__;
                        const originModuleInstance = originalFactory();
                        const originModuleId = Object.entries(originRequire.c).find(([, { exports }]) => exports === originModuleInstance)?.[0];
                        if (!originModuleId) {
                            console.warn(`[ModuleFederationIsolationRuntime] Could not find the module ID for the ${pkgName} entrypoint in the ${resolvedDependency.from} host cache`);
                            updateSharedModuleRedirections(ownRequire.federation.isolation, pkgName, pkgVersion, null);
                            return originalFactory;
                        }
                        updateSharedModuleRedirections(ownRequire.federation.isolation, pkgName, pkgVersion, {
                            mid: originModuleId,
                            originRequire,
                        });
                        if (stateStrategy === 'use-origin') {
                            return originalFactory;
                        }
                        const createPatchedRequire = stateStrategy === 'use-isolated' ? createIsolationRequire : createTranslationRequire;
                        const patchedRequire = createPatchedRequire(ownRequire, originRequire, `mfi/${ownRequire.federation.isolation.hostName}/${pkgName}/${pkgVersion}`);
                        return () => patchedRequire(originModuleId);
                    }),
                });
                return args;
            },
        };
    };
}
exports.createMfiRuntimePlugin = createMfiRuntimePlugin;
