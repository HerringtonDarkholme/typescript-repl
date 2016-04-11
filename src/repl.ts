/// <reference path='../typings/node.d.ts' />
/// <reference path='../typings/colors.d.ts' />
declare var Reflect: any
declare var Promise: any

import * as readline from 'node-color-readline'
import * as util from 'util'
import * as vm from 'vm'
import * as path from 'path'
import {Console} from 'console'
import * as ts from 'typescript'
import * as fs from 'fs'
import * as os from 'os'
import * as child_process from 'child_process'

var Module = require('module')

import 'colors'

const DUMMY_FILE = 'TSUN.repl.generated.ts'

var options = require('optimist')
  .alias('f', 'force')
  .describe('f', 'Force tsun to evaluate code with ts errors.')
  .alias('v', 'verbose')
  .describe('v', 'Print compiled javascript before evaluating.')
  .describe('dere', "I-its's not like I'm an option so DON'T GET THE WRONG IDEA!")

var argv = options.argv

var defaultPrompt = '> ', moreLinesPrompt = '..'
var verbose = argv.verbose
var versionCounter = 0
var codes = getInitialCommands()
var buffer = ''
var rl = createReadLine()

var serviceHost: ts.LanguageServiceHost = {
  getCompilationSettings: () => ({
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES5,
    newLine: ts.NewLineKind.LineFeed,
    noEmitHelpers: true,
    experimentalDecorators: true
  }),
  getScriptFileNames: () => [DUMMY_FILE],
  getScriptVersion: (fileName) => {
    return fileName === DUMMY_FILE && versionCounter.toString()
  },
  getScriptSnapshot: (fileName) => {
    try {
      var text = fileName === DUMMY_FILE
        ? codes
        : fs.readFileSync(fileName).toString()
      return ts.ScriptSnapshot.fromString(text)
    } catch(e) {

    }
  },
  getCurrentDirectory: () => process.cwd(),
  getDefaultLibFileName: (options) => path.join(__dirname, '../../node_modules/typescript/lib/lib.core.es6.d.ts')
}

var service = ts.createLanguageService(serviceHost, ts.createDocumentRegistry())



function getDeclarationFiles() {
  var libPaths = [path.resolve(__dirname, '../../typings/node.d.ts')]
  try {
    let typings = path.join(process.cwd(), './typings')
    let dirs = fs.readdirSync(typings)
    for (let dir of dirs) {
      if (!/\.d\.ts$/.test(dir)) continue
      let p = path.join(typings, dir)
      if (fs.statSync(p).isFile()) {
        libPaths.push(p)
      }
    }
  } catch(e) {
  }
  return libPaths
}

function getInitialCommands() {
  var codes = getDeclarationFiles().map(dir => `/// <reference path="${dir}" />`)
  return codes.join('\n')
}


function createReadLine() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    colorize(line) {
      let colorized = ''
      let regex: [RegExp, string][] = [
        [/\/\//, 'grey'], // comment
        [/(['"`\/]).*?(?!<\\)\1/, 'cyan'], // string/regex, not rock solid
        [/[+-]?(\d+\.?\d*|\d*\.\d+)([eE][+-]?\d+)?/, 'cyan'], // number
        [/\b(true|false|null|undefined|NaN|Infinity)\b/, 'blue'],
        [/\b(in|if|for|while|var|new|function|do|return|void|else|break)\b/, 'green'],
        [/\b(instanceof|with|case|default|try|this|switch|continue|typeof)\b/, 'green'],
        [/\b(let|yield|const|class|extends|interface|type)\b/, 'green'],
        [/\b(try|catch|finally|Error|delete|throw|import|from|as)\b/, 'red'],
        [/\b(eval|isFinite|isNaN|parseFloat|parseInt|decodeURI|decodeURIComponent)\b/, 'yellow'],
        [/\b(encodeURI|encodeURIComponent|escape|unescape|Object|Function|Boolean|Error)\b/, 'yellow'],
        [/\b(Number|Math|Date|String|RegExp|Array|JSON|=>|string|number|boolean)\b/, 'yellow'],
        [/\b(console|module|process|require|arguments|fs|global)\b/, 'yellow'],
        [/\b(private|public|protected|abstract|namespace|declare|@)\b/, 'magenta'], // TS keyword
      ]
      while (line !== '') {
        let start = +Infinity
        let color = ''
        let length = 0
        for (let reg of regex) {
          let match = reg[0].exec(line)
          if (match && match.index < start) {
            start = match.index
            color = reg[1]
            length = match[0].length
          }
        }
        colorized += line.substring(0, start)
        if (color) {
          colorized += (<any>line.substr(start, length))[color]
        }
        line = line.substr(start + length)
      }
      return colorized
    },
    completer(line: string) {
      // append new line to get completions, then revert new line
      versionCounter++
      let originalCodes = codes
      codes += buffer + '\n' + line
      if (':' === line[0]) {
        let candidates = ['type', 'detail', 'source', 'paste', 'clear', 'print', 'help']
        candidates = candidates.map(c => ':' + c).filter(c => c.indexOf(line) >= 0)
        return [candidates, line.trim()]
      }
      let completions = service.getCompletionsAtPosition(DUMMY_FILE, codes.length)
      if (!completions) {
        codes = originalCodes
        return [[], line]
      }
      let prefix = /[A-Za-z_$]+$/.exec(line)
      let candidates: string[] = []
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
  var builtinLibs = require('repl')._builtinLibs
  var context: any;
  context = vm.createContext();
  for (var g in global) {
    context[g] = global[g];
  }

  // generate helper, adapted from TypeScript compiler
  context['__extends'] = function (d: any, b: any) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    let __: any = function () { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
  }

  context['__assign'] = function(t: any) {
    for (var s: any, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
        t[p] = s[p];
    }
    return t
  }

  // emit output for the __decorate helper function
  context['__decorate'] = function (decorators: any, target: any, key: any, desc: any) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d: any;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
  }

  // emit output for the __metadata helper function
  context['__metadata'] = function (k: any, v: any) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
  }

  // emit output for the __param helper function
  context['__param'] = function (paramIndex: any, decorator: any) {
    return function (target: any, key: any) { decorator(target, key, paramIndex); }
  };

  context['__awaiter'] = function (thisArg: any, _arguments: any, P: any, generator: any) {
    return new (P || (P = Promise))(function (resolve: any, reject: any) {
      function fulfilled(value: any) { try { step(generator.next(value)); } catch (e) { reject(e); } }
      function rejected(value: any) { try { step(generator.throw(value)); } catch (e) { reject(e); } }
      function step(result: any) { result.done ? resolve(result.value) : new P(function (resolve: any) { resolve(result.value); }).then(fulfilled, rejected); }
      step((generator = generator.apply(thisArg, _arguments)).next());
    });
  };
  context.console = new Console(process.stdout);
  context.global = context;
  context.global.global = context;
  context.module = new Module('<repl>');
  try {
    // hack for require.resolve("./relative") to work properly.
    context.module.filename = path.resolve('repl');
  } catch (e) {
    // path.resolve('repl') fails when the current working directory has been
    // deleted.  Fall back to the directory name of the (absolute) executable
    // path.  It's not really correct but what are the alternatives?
    const dirname = path.dirname(process.execPath);
    context.module.filename = path.resolve(dirname, 'repl');
  }
  context.module.paths = Module._nodeModulePaths(context.module.filename)
  context.paths = Module._resolveLookupPaths(process.cwd(), context.module)[1]
  var req = context.module.require.bind(context.module)
  context.require = req

  // Lazy load modules on use
  builtinLibs.forEach(function (name: string) {
    Object.defineProperty(context, name, {
      get: function () {
        var lib = require(name);
        context[name] = lib;
        return lib;
      },
      // Allow creation of globals of the same name
      set: function (val: any) {
        delete context[name];
        context[name] = val;
      },
      configurable: true
    });
  });

  return context;
}

// private api hacks
function collectDeclaration(sourceFile: any): any {
  let decls = sourceFile.getNamedDeclarations()
  var ret: any = {}
  for (let decl in decls) {
    ret[decl] = decls[decl].map((t: any) => t.name)
  }
  return ret
}

var getDeclarations = (function() {
  var declarations: {[fileName: string]: {[name: string]: ts.DeclarationName[]}} = {}
  let declFiles = getDeclarationFiles().concat(path.join(__dirname, '../../node_modules/typescript/lib/lib.core.es6.d.ts'))
  for (let file of declFiles) {
    let text = fs.readFileSync(file, 'utf8')
    declarations[file] = collectDeclaration(ts.createSourceFile(file, text, ts.ScriptTarget.Latest))
  }
  return function(cached: boolean = false) {
    if (!cached) {
      declarations[DUMMY_FILE] = collectDeclaration(ts.createSourceFile(DUMMY_FILE, codes, ts.ScriptTarget.Latest))
    }
    return declarations
  }
})()


function getMemberInfo(member: ts.ClassElement, file: string, parentDeclaration: any): string {
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

function getSource(name: string) {
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
       let tempFile = temp.openSync('DUMMY_FILE' + Math.random())
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

function getType(name: string, detailed: boolean) {
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

function getDiagnostics(): string[] {
  let allDiagnostics = service.getCompilerOptionsDiagnostics()
    .concat(service.getSemanticDiagnostics(DUMMY_FILE))

  return allDiagnostics.map(diagnostic => {
    let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    return message
  })
}

var storedLine = 0
function getCurrentCode() {
  let emit = service.getEmitOutput(DUMMY_FILE)
  let lines = emit.outputFiles[0].text.split('\r\n').filter(k => !!k)
  let ret = lines.slice(storedLine).join('\n')
  storedLine = lines.length
  return ret
}

var context = createContext();
function startEvaluate(code: string) {
  buffer = ''
  let fallback = codes
  codes += code
  versionCounter++
  let allDiagnostics = getDiagnostics()
  if (allDiagnostics.length) {
    codes = fallback
    console.warn(allDiagnostics.join('\n').bold.red)
    if (defaultPrompt != '> ') {
      console.log('')
      console.log(defaultPrompt, 'URUSAI URUSAI URUSAI'.magenta)
      console.log('')
    }
    return repl(defaultPrompt);
  }
  let current = getCurrentCode()
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

function replLoop(prompt: string, code: string) {
  let fallback = codes
  let userInput = code
  versionCounter++
  code = buffer + '\n' + code
  codes += code
  let diagnostics = service.getSyntacticDiagnostics(DUMMY_FILE)
  if (diagnostics.length === 0) {
    codes = fallback
    startEvaluate(code)
    repl(defaultPrompt)
  } else {
    codes = fallback
    let openCurly = (code.match(/\{/g) || []).length;
    let closeCurly = (code.match(/\}/g) || []).length;
    let openParen = (code.match(/\(/g) || []).length;
    let closeParen = (code.match(/\)/g) || []).length;
    // at lease one indent in multiline
    let indentLevel = (openCurly - closeCurly + openParen - closeParen) || 1
    waitForMoreLines(code, indentLevel || 1)
  }
}

function addLine(line: string) {
  buffer += '\n' + line
}

function enterPasteMode() {
  console.log('// entering paste mode, press ctrl-d to evaluate'.cyan)
  console.log('')
  let oldPrompt = defaultPrompt
  rl.setPrompt('')
  rl.on('line', addLine)
  rl.once('close', (d: any) => {
    console.log('evaluating...'.cyan)
    rl.removeListener('line', addLine)
    startEvaluate(buffer)
    rl = createReadLine()
    repl(defaultPrompt = oldPrompt)
  })
}

// main loop
function repl(prompt: string) {
  'use strict';
  rl.question(prompt, function (code: string) {
    if (/^:(type|detail)/.test(code)) {
      let identifier = code.split(' ')[1]
      if (!identifier) {
        console.log(':type|detail command need names!'.red)
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

export function startRepl() {
  repl(defaultPrompt)
}
