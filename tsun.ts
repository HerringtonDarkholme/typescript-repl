/// <reference path='./typings/node.d.ts' />
/// <reference path='./typings/colors.d.ts' />
/// <reference path='./node_modules/typescript/lib/typescript.d.ts' />

import readline = require('readline')
import util = require('util')
import vm = require('vm')
import path = require('path')
import ConsoleModule = require('console')
import ts = require('typescript')
import fs = require('fs')
import colors = require('colors')
import os = require('os')
import child_process = require('child_process')

var Console = ConsoleModule.Console
var builtinLibs = require('repl')._builtinLibs

// workaround for ts import
colors.setTheme({
  warn: 'red'
})

var options = require('optimist')
  .usage('A TypeScript REPL.\nUsage: $0')
  .alias('h', 'help')
  .describe('h', 'Print this help message')
  .alias('f', 'force')
  .describe('f', 'Force tsun to evaluate code with ts errors.')
  .alias('v', 'verbose')
  .describe('v', 'Print compiled javascript before evaluating.')
  .alias('o', 'out')
  .describe('o', 'output directory relative to temporary')
  .alias('a', 'autoref')
  .describe('a', 'add reference of definition under ./typings directory')
  .describe('dere', "I-its's not like I'm an option so DON'T GET THE WRONG IDEA!")

var argv = options.argv

if (argv._.length === 1) {
  runCode()
}
if (argv.h) {
  options.showHelp()
  process.exit(1)
}

function runCode() {
  // run code in temp path, and cleanup
  var temp = require('temp')
  temp.track()
  process.on('SIGINT',  () => temp.cleanupSync())
  process.on('SIGTERM', () => temp.cleanupSync())

  let tempPath = temp.mkdirSync('tsrun')
  let outDir = tempPath
  if (argv.o) {
    outDir = path.join(tempPath, argv.o)
  }
  let compileError = compile(argv._, {
      outDir,
      noEmitOnError: true,
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
  })
  if (compileError) process.exit(compileError)
  linkDir(process.cwd(), tempPath)
  // slice argv. 0: node, 1: tsun binary 2: arg
  var newArgv = process.argv.slice(2).map(arg => {
    if (!/\.ts$/.test(arg)) return arg
    return path.join(outDir, arg.replace(/ts$/, 'js'))
  })
  child_process.execFileSync('node', newArgv, {
    stdio: 'inherit'
  })
  process.exit()
}

function linkDir(src, dest) {
  let files = ['node_modules', 'typings']
  for (let file of files) {
    let srcpath = path.join(src, file)
    let destpath = path.join(dest, file)
    fs.symlinkSync(srcpath, destpath, 'dir')
  }
}

function compile(fileNames: string[], options: ts.CompilerOptions): number {
    var program = ts.createProgram(fileNames, options);
    var emitResult = program.emit();

    var allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

    allDiagnostics.forEach(diagnostic => {
      var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (!diagnostic.file) return console.log(message)
      var { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
    });

    var exitCode = emitResult.emitSkipped ? 1 : 0;
    return exitCode
}


/**
 * interpreter start
 */

var defaultPrompt = '> ', moreLinesPrompt = '..';
var context = createContext();
var verbose = argv.v;

function getDeclarationFiles() {
  var libPaths = [path.resolve(__dirname, '../typings/node.d.ts')]
  if (argv.autoref) {
    try {
      let dirs = fs.readdirSync('typings')
      for (let dir of dirs) {
        libPaths.push(path.join('typings', dir))
      }
    } catch(e) {
    }
  }
  return libPaths
}

function getInitialCommands() {
  var codes = getDeclarationFiles().map(dir => `/// <reference path="${dir}" />`)
  return codes.join('\n')
}

var versionCounter = 0
var dummyFile = 'TSUN.repl.generated.ts'
var codes = getInitialCommands()
var buffer = ''
var rl = createReadLine()

var serviceHost: ts.LanguageServiceHost = {
  getCompilationSettings: () => ({
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES5,
    experimentalDecorators: true
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
  getDefaultLibFileName: (options) => path.join(__dirname, '../node_modules/typescript/lib/lib.core.es6.d.ts')
}

var service = ts.createLanguageService(serviceHost, ts.createDocumentRegistry())

function createReadLine() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer(line) {
      // append new line to get completions, then revert new line
      versionCounter++
      let originalCodes = codes
      codes += buffer + '\n' + line
      if (':' === line[0]) {
        let candidates = ['type', 'detail', 'source', 'paste', 'clear', 'print', 'help']
		candidates = candidates.map(c => ':' + c).filter(c => c.indexOf(line) >= 0)
        return [candidates, line.trim()]
      }
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
  })
}

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

// private api hacks
function collectDeclaration(sourceFile): any {
	let decls = sourceFile.getNamedDeclarations()
	var ret = {}
	for (let decl in decls) {
		ret[decl] = decls[decl].map(t => t.name)
	}
	return ret
}

var getDeclarations = (function() {
  var declarations: {[fileName: string]: {[name: string]: ts.DeclarationName[]}} = {}
  let declFiles = getDeclarationFiles().concat(path.join(__dirname, '../node_modules/typescript/lib/lib.core.es6.d.ts'))
  for (let file of declFiles) {
    declarations[file] = collectDeclaration(service.getSourceFile(file))
  }
  return function(cached: boolean = false) {
    if (!cached) {
		declarations[dummyFile] = collectDeclaration(service.getSourceFile(dummyFile))
    }
    return declarations
  }
})()


function getMemberInfo(member, file, parentDeclaration): string {
  // member info is stored as the first
  let pos = member.getStart()
  let quickInfo = service.getQuickInfoAtPosition(file, pos)
  if (quickInfo) return ts.displayPartsToString(quickInfo.displayParts)
  // DeclarationName includes Identifier which does not have name and will not go here
  let name = member.name && member.name.getText()
  if (!name) return member.getText()
  let declarations = getDeclarations(true)[file][name]
  for (let decl of declarations) {
    let d: any = decl
    if (parentDeclaration.parent.name.getText() == d.parent.parent.name.getText()) {
      let quickInfo = service.getQuickInfoAtPosition(file, d.getEnd())
      return ts.displayPartsToString(quickInfo.displayParts)
    }
  }
  return member.getText()
}

function getTypeInfo(decl: ts.Node, file: string, detailed: boolean): string[] {
  // getStart will count comment
  let pos = decl.getEnd()
  let ret = [`declaration in: ${file}`]
  let quickInfo = service.getQuickInfoAtPosition(file, pos)
  ret.push(ts.displayPartsToString(quickInfo.displayParts))
  if (!detailed) return ret
  let parentName = ret[1].split(' ')[1]
  let symbolType = quickInfo.displayParts[0].text
  if ( symbolType === 'interface' || symbolType === 'class') {
    let classLikeDeclaration = <ts.ClassLikeDeclaration>decl.parent
    for (let member of classLikeDeclaration.members) {
      let memberInfo = getMemberInfo(member, file, decl).split('\n').map(mInfo => {
        mInfo = mInfo.replace(new RegExp(parentName + '\\.', 'g'), '')
        return '    ' + mInfo
      })
      ret.push(memberInfo.join('\n'))
    }
  }
  return ret

}

function getSource(name) {
  let declarations = getDeclarations()
  for (let file in declarations) {
    let names = declarations[file]
    if (names[name]) {
      let decl = names[name]
      let pager = process.env.PAGER
      let text = decl[0].parent.getFullText()
      if (!pager || text.split('\n').length < 24) {
        console.log(text)
        repl(defaultPrompt)
        return
       }
       process.stdin.pause()
       var tty = require('tty')
       tty.setRawMode(false)
       var temp = require('temp')
       let tempFile = temp.openSync('dummyFile' + Math.random())
       fs.writeFileSync(tempFile.path, text)
       let display = child_process.spawn('less', [tempFile.path], {
         'stdio': [0, 1, 2]
       })
       display.on('exit', function() {
         temp.cleanupSync()
         tty.setRawMode(true)
         process.stdin.resume()
         repl(defaultPrompt)
       })
       return
    }
  }
  console.log(`identifier ${name} not found`.yellow)
}

function getType(name, detailed) {
  let declarations = getDeclarations()
  for (let file in declarations) {
    let names = declarations[file]
    if (names[name]) {
      let decl = names[name][0]
      let infoString = getTypeInfo(decl, file, detailed)
      console.log(infoString.join('\n').cyan)
      return
    }
  }
  console.log(`identifier ${name} not found`.yellow)
}

function printHelp() {
  console.log(`
tsun repl commands
:type symbol       print the type of an identifier
:detail symbol     print details of identifier
:source symbol     print source of identifier
:clear             clear all the code
:print             print code input so far
:help              print this manual
:paste             enter paste mode`.blue)
  if (argv.dere) {
  console.log(':baka              Who would like some pervert like you, baka~'.blue)
  }
}

function getDiagnostics() {
  let emit = service.getEmitOutput(dummyFile)
  let allDiagnostics = service.getCompilerOptionsDiagnostics()
    .concat(service.getSyntacticDiagnostics(dummyFile))
    .concat(service.getSemanticDiagnostics(dummyFile))

  allDiagnostics.forEach(diagnostic => {
    let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    console.warn(message.red.bold)
  })
  return allDiagnostics
}

function startEvaluate(code) {
  buffer = ''
  let fallback = codes
  codes += code
  versionCounter++
  let allDiagnostics = getDiagnostics()
  if (allDiagnostics.length) {
    codes = fallback
  if (defaultPrompt != '> ') {
    console.log('')
    console.log(defaultPrompt, 'URUSAI URUSAI URUSAI'.magenta)
    console.log('')
  }
    return repl(defaultPrompt);
  }
  let current = ts.transpile(code)
  // workaround
  if (code.trim().substr(0, 6) === 'import' && !current.trim()) {
    current = code.replace(/^\s*import/, 'var')
  }
  if (verbose) {
    console.log(current.green);
  }
  try  {
    var result = vm.runInContext(current, context);
    console.log(util.inspect(result, false, 2, true));
  } catch (e) {
    console.log(e.stack);
  }

}

function waitForMoreLines(code: string, indentLevel: number) {
  if (/\n{2}$/.test(code)) {
    console.log('You typed two blank lines! start new command'.yellow)
    buffer = ''
    return repl(defaultPrompt)
  }
  var nextPrompt = '';
  for (var i = 0; i < indentLevel; i++) {
    nextPrompt += moreLinesPrompt;
  }
  buffer = code
  repl(nextPrompt);
}

function replLoop(prompt, code) {
  code = buffer + '\n' + code;
  var openCurly = (code.match(/\{/g) || []).length;
  var closeCurly = (code.match(/\}/g) || []).length;
  var openParen = (code.match(/\(/g) || []).length;
  var closeParen = (code.match(/\)/g) || []).length;
  var templateClosed = (code.match(/`/g) || []).length % 2 === 0;
  if (openCurly === closeCurly && openParen === closeParen && templateClosed) {
    startEvaluate(code)
    repl(defaultPrompt)
  } else {
    let indentLevel = openCurly - closeCurly + openParen - closeParen;
    waitForMoreLines(code, indentLevel)
  }
}

function addLine(line) {
  buffer += '\n' + line
}

function enterPasteMode() {
  console.log('// entering paste mode, press ctrl-d to evaluate'.cyan)
  console.log('')
  let oldPrompt = defaultPrompt
  rl.setPrompt('')
  rl.on('line', addLine)
  rl.once('close', (d) => {
    console.log('evaluating...'.cyan)
    rl.removeListener('line', addLine)
    startEvaluate(buffer)
    rl = createReadLine()
    repl(defaultPrompt = oldPrompt)
  })
}

// main loop
function repl(prompt) {
  'use strict';
  rl.question(prompt, function (code) {
    if (/^:(type|t|detail)/.test(code)) {
      let identifier = code.split(' ')[1]
      if (!identifier) {
        console.log(':type|t|detail command need names!'.red)
        return repl(prompt)
      }
      getType(identifier, code.indexOf('detail') === 1)
      return repl(prompt)
    }
    if (/^:source/.test(code)) {
      let identifier = code.split(' ')[1]
      if (!identifier) {
        console.log(':source command need names!'.red)
        return repl(prompt)
      }
      getSource(identifier)
      return
    }
    if (/^:help/.test(code)) {
      printHelp()
      return repl(prompt)
    }
    if (/^:clear/.test(code)) {
      codes = getInitialCommands()
      buffer = ''
      context = createContext()
      return repl(defaultPrompt)
    }
    if (/^:print/.test(code)) {
      console.log(codes)
      return repl(prompt)
    }
    if (/^:paste/.test(code) && !buffer) {
      return enterPasteMode()
    }
    if (argv.dere && /^:baka/.test(code)) {
      defaultPrompt   = 'ξ(ﾟ⊿ﾟ)ξ> '
      moreLinesPrompt = 'ζ(///*ζ) ';
      return repl(defaultPrompt)
    }
    replLoop(prompt, code)
  });
}

if (!argv.dere) {
  console.log('TSUN'.blue, ': TypeScript Upgraded Node')
  console.log('type in TypeScript expression to evaluate')
  console.log('type', ':help'.blue.bold, 'for commands in repl')
} else {
  console.log('TSUN'.magenta, " I'm- I'm not making this repl because I like you or anything!")
  console.log("don'... don't type ", ':help'.magenta.bold, ', okay? Idiot!')
}

console.log('')
repl(defaultPrompt);
