/// <reference path='./typings/node.d.ts' />
/// <reference path='./typings/colors.d.ts' />
/// <reference path='./typings/typescript.d.ts' />

var readline = require('readline')
var util = require('util')
var vm = require('vm')

import path = require('path')
import ConsoleModule = require('console')
var Console = ConsoleModule.Console
var builtinLibs = require('repl')._builtinLibs
import ts = require('typescript')
import fs = require('fs')
import colors = require('colors')
colors.setTheme({
  warn: 'red'
})

var options = require('optimist')
  .usage('A simple ts REPL.\nUsage: $0')
  .alias('h', 'help')
  .describe('h', 'Print this help message')
  .alias('f', 'force')
  .describe('f', 'Force tsi to evaluate code with ts errors.')
  .alias('v', 'verbose')
  .describe('v', 'Print compiled javascript before evaluating.')

var argv = options.argv

if (argv.h) {
  options.showHelp()
  process.exit(1)
}

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer(line) {
    versionCounter++
    let originalCodes = codes
    codes += '\n' + line
    let completions = service.getCompletionsAtPosition(dummyFile, codes.length)
    if (!completions) {
      codes = originalCodes
      return [[], line]
    }
    let prefix = /[A-Za-z_$]+$/.exec(line)
    let candidates = []
    if (prefix) {
      let prefixStr = prefix[0]
      candidates = completions.entries.filter((entry) => {
        let name = entry.name
        return name.substr(0, prefixStr.length) == prefixStr
      }).map(entry => entry.name)
    } else {
      candidates = completions.entries.map(entry => entry.name)
    }
    codes = originalCodes
    return [candidates, prefix ? prefix[0] : line]
  }
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

var libPath = path.resolve(__dirname, '../typings/node.d.ts')
var codes = `/// <reference path="${libPath}" />`
var versionCounter = 0
var dummyFile = '__dummy__' + Math.random() + '.ts'
var serviceHost: ts.LanguageServiceHost = {
	getCompilationSettings: () => ({
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES5
	}),
	getScriptFileNames: () => [dummyFile],
	getScriptVersion: (fileName) => {
		return fileName === dummyFile && versionCounter.toString()
	},
	getScriptSnapshot: (fileName) => {
    try {
      var text = fileName === dummyFile
        ? codes
        : fs.readFileSync(fileName).toString()
      return ts.ScriptSnapshot.fromString(text)
    } catch(e) {

    }
	},
	getCurrentDirectory: () => process.cwd(),
	getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options)
}

var service = ts.createLanguageService(serviceHost, ts.createDocumentRegistry())



function repl(prompt, prefix) {
  'use strict';
  rl.question(prompt, function (code) {
    code = prefix + '\n' + code;
    var openCurly = (code.match(/\{/g) || []).length;
    var closeCurly = (code.match(/\}/g) || []).length;
    var openParen = (code.match(/\(/g) || []).length;
    var closeParen = (code.match(/\)/g) || []).length;
    if (openCurly === closeCurly && openParen === closeParen) {
      let fallback = codes
      codes += code
      versionCounter++
      let current = ts.transpile(code)
      let emit = service.getEmitOutput(dummyFile)
      let allDiagnostics = service.getCompilerOptionsDiagnostics()
        .concat(service.getSyntacticDiagnostics(dummyFile))
        .concat(service.getSemanticDiagnostics(dummyFile))

      allDiagnostics.forEach(diagnostic => {
        let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        console.warn(message.red.bold);
      })
      if (verbose) {
        console.debug(current);
      }
      if (allDiagnostics.length) {
        codes = fallback
        return repl(defaultPrompt, defaultPrefix);
      }
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

