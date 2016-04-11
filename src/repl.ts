/// <reference path='../typings/node.d.ts' />
/// <reference path='../typings/colors.d.ts' />

declare var Reflect: any
declare var Promise: any

import * as readline from 'node-color-readline'
import * as util from 'util'
import * as vm from 'vm'
import {Console} from 'console'
import * as path from 'path'

import {completer, codes, getType, getDiagnostics, getCurrentCode, getSource, getSyntacticDiagnostics, clearHistory} from './service'

var Module = require('module')

import 'colors'

var options = require('optimist')
  .alias('f', 'force')
  .describe('f', 'Force tsun to evaluate code with ts errors.')
  .alias('v', 'verbose')
  .describe('v', 'Print compiled javascript before evaluating.')
  .describe('dere', "I-its's not like I'm an option so DON'T GET THE WRONG IDEA!")

var argv = options.argv
var verbose = argv.verbose

export var defaultPrompt = '> ', moreLinesPrompt = '..'
var buffer = ''
var rl = createReadLine()


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
      let code = buffer + '\n' + line
	  return completer(code)
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



var context = createContext();
function startEvaluate(code: string) {
  buffer = ''
  let allDiagnostics = getDiagnostics(code)
  if (allDiagnostics.length) {
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
  code = buffer + '\n' + code
  let diagnostics = getSyntacticDiagnostics(code)
  if (diagnostics.length === 0) {
    startEvaluate(code)
    repl(defaultPrompt)
  } else {
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
export function repl(prompt: string) {
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
      clearHistory()
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
