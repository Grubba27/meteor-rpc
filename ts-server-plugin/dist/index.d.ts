declare function init(modules: {
    typescript: typeof import("typescript/lib/tsserverlibrary");
}): {
    create: (info: ts.server.PluginCreateInfo) => ts.LanguageService;
};
export = init;
//# sourceMappingURL=index.d.ts.map