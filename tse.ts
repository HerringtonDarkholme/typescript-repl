/// <reference path='./typings/node.d.ts' />
/// <reference path='./typings/typescript.d.ts' />

var readline = require('readline');
var util = require('util');
var vm = require('vm');

import ConsoleModule = require('console');
var Console = ConsoleModule.Console;
var builtinLibs = require('repl')._builtinLibs;
import typescript = require('typescript');

var options = require('optimist')
  .usage('A simple typescript REPL.\nUsage: $0')
  .alias('h', 'help')
  .describe('h', 'Print this help message')
  .alias('f', 'force')
  .describe('f', 'Force tsi to evaluate code with typescript errors.')
  .alias('v', 'verbose')
  .describe('v', 'Print compiled javascript before evaluating.');

var argv = options.argv;

if (argv.h) {
  options.showHelp();
  process.exit(1);
}

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Much of this function is from repl.REPLServer.createContext
function createContext() {
  'use strict';
  var context;
  context = vm.createContext();
  for (var g in global) {
    context[g] = global[g];
  }
  context.console = new Console(process.stdout);
  context.global = context;
  context.global.global = context;
  context.module = module;
  context.require = require;

  // Lazy load modules on use
  builtinLibs.forEach(function (name) {
    Object.defineProperty(context, name, {
      get: function () {
        var lib = require(name);
        context[name] = lib;
        return lib;
      },
      // Allow creation of globals of the same name
      set: function (val) {
        delete context[name];
        context[name] = val;
      },
      configurable: true
    });
  });

  return context;
}

var defaultPrompt = '> ', moreLinesPrompt = '..';
var defaultPrefix = '';
var context = createContext();
var verbose = argv.v;

var code = ''
var codes = ''
var versionCounter = 0
var languageServiceHost: typescript.LanguageServiceHost = {
	getCompilationSettings: () => ({
		module: typescript.ModuleKind.CommonJS,
		target: typescript.ScriptTarget.Latest
	}),
	getNewLine: () => code,
	getScriptFileNames: () => (['dummy.ts']),
	getScriptVersion: () => ('' + (versionCounter++)),
	getScriptSnapshot: () => typescript.ScriptSnapshot.fromString(codes),
	getCurrentDirectory: () => process.cwd(),
	getDefaultLibFileName: (options) => typescript.getDefaultLibFilePath(options)

}
function repl(prompt, prefix) {
  'use strict';
  rl.question(prompt, function (c) {
    code = prefix + '\n' + c;
    var openCurly = (code.match(/\{/g) || []).length;
    var closeCurly = (code.match(/\}/g) || []).length;
    var openParen = (code.match(/\(/g) || []).length;
    var closeParen = (code.match(/\)/g) || []).length;
    if (openCurly === closeCurly && openParen === closeParen) {
      var current = typescript.transpile(code);
      if (verbose) {
        console.log(current);
      }
      // for (var i = 0; i < current.diagnostics.length; i++) {
      //   console.log(current.diagnostics[i].message);
      // }
      try  {
        var result = vm.runInContext(current, context);
        console.log(util.inspect(result, false, 2, true));
      } catch (e) {
        console.log(e.stack);
      }
      repl(defaultPrompt, defaultPrefix);
    } else {
      var indentLevel = openCurly - closeCurly + openParen - closeParen;
      var nextPrompt = '';
      for (var i = 0; i < indentLevel; i++) {
        nextPrompt += moreLinesPrompt;
      }
      repl(nextPrompt, code);
    }
  });
}
repl(defaultPrompt, defaultPrefix);

