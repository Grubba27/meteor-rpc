Package.describe({
  name: 'grubba:rpc',
  version: '0.3.0',
  summary: 'Evolved RPC Methods for Meteor',
  documentation: 'README.md'
});

Npm.depends({
  "zod": "3.18.0",
});

Package.onUse(function (api) {
  api.versionsFrom('2.7.3');
  api.use('isobuild:compiler-plugin@1.0.0');
  api.use('babel-compiler');
  api.imply('modules');
  api.imply('ecmascript-runtime');
  api.imply('promise');
  // Runtime support for Meteor 1.5 dynamic import(...) syntax.
  api.imply('dynamic-import');
  api.use('typescript');
  api.use('ddp-rate-limiter');
  api.use('zodern:types@1.0.0');
  api.mainModule('server-main.ts', [
    "server"
  ]);
});

Package.onTest(function (api) {
  api.use('tinytest');
  api.use('es5-shim');
  api.use('typescript');
  api.use('isobuild:compiler-plugin@1.0.0');
  api.use('babel-compiler');
  api.imply('modules');
  api.imply('ecmascript-runtime');
  api.imply('promise');
  // Runtime support for Meteor 1.5 dynamic import(...) syntax.
  api.imply('dynamic-import');
  api.use('ddp-rate-limiter');
  api.mainModule("tests/index.ts");
});
