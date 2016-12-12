import * as readlineTTY from 'node-color-readline'
import * as readlineNoTTY from 'readline'
import * as util from 'util'
import * as vm from 'vm'
import * as tty from 'tty'
import {Console} from 'console'
import * as path from 'path'
import * as child_process from 'child_process'
import * as fs from 'fs'

import {
  completer, acceptedCodes, testSyntacticError, clearHistory,
  getType, getDiagnostics, getCurrentCode, getDeclarations,
} from './service'

import {assign} from './util'

var Module = require('module')

import 'colors'

// node-color-readline blows up in non-TTY envs
const readline = (process.stdout as tty.WriteStream).isTTY ? readlineTTY : readlineNoTTY

var options = require('optimist')
  .alias('f', 'force')
  .describe('f', 'Force tsun to evaluate code with ts errors.')
  .alias('v', 'verbose')
  .describe('v', 'Print compiled javascript before evaluating.')
  .describe('dere', "I-its's not like I'm an option so DON'T GET THE WRONG IDEA!")

var argv = options.argv
var verbose = argv.verbose

export var defaultPrompt = '> ', moreLinesPrompt = '..'
// a buffer for multiline editing
var multilineBuffer = ''
var rl = createReadLine()

function colorize(line: string) {
  let colorized = ''
  let regex: [RegExp, string][] = [
    [/\/\/.*$/m, 'grey'], // comment
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
    [/\b(keyof|readonly)\b/, 'green'],
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
}

function createReadLine() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    colorize: colorize,
    completer(line: string) {
      let code = multilineBuffer + '\n' + line
      return completer(code) as any
    }
  })
}

// Much of this function is from repl.REPLServer.createContext
function createContext() {
  var builtinLibs = require('repl')._builtinLibs
  var context: any;
  context = vm.createContext();
  assign(context, global)

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
:doc  symbol       print the documentation for an identifier
:clear             clear all the code
:print             print code input so far
:help              print this manual
:paste             enter paste mode
:load filename     source typescript file in current context`.blue)
  if (argv.dere) {
  console.log(':baka              Who would like some pervert like you, baka~'.blue)
  }
}



var context = createContext();
function startEvaluate(code: string) {
  multilineBuffer = ''
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
    multilineBuffer = ''
    return repl(defaultPrompt)
  }
  var nextPrompt = '';
  for (var i = 0; i < indentLevel; i++) {
    nextPrompt += moreLinesPrompt;
  }
  multilineBuffer = code
  repl(nextPrompt);
}

function replLoop(_: string, code: string) {
  code = multilineBuffer + '\n' + code
  let diagnostics = testSyntacticError(code)
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
  multilineBuffer += '\n' + line
}

function enterPasteMode() {
  console.log('// entering paste mode, press ctrl-d to evaluate'.cyan)
  console.log('')
  let oldPrompt = defaultPrompt
  rl.setPrompt('')
  rl.on('line', addLine)
  rl.once('close', () => {
    console.log('evaluating...'.cyan)
    rl.removeListener('line', addLine)
    startEvaluate(multilineBuffer)
    rl = createReadLine()
    repl(defaultPrompt = oldPrompt)
  })
}

function loadFile(filename: string) {
  try {
    let filePath = path.resolve(filename)
    let fileContents: string = fs.readFileSync(filePath, 'utf8')
    if (verbose) {
      console.log(`loading file: ${filePath}`.cyan)
      console.log(colorize(fileContents))
      console.log('evaluating...'.cyan)
    }
    startEvaluate(fileContents)
  } catch(e) {
    console.log(e)
  }
}

function loadFiles(filenames: string[]) {
  filenames.forEach((filename) => {
    loadFile(filename)
  })
}

function getSource(name: string) {
  let declarations = getDeclarations()
  for (let file in declarations) {
    let names = declarations[file]
    if (names[name]) {
      let decl = names[name]
      let pager = process.env.PAGER
      let parent = decl[0].parent
      let text =  parent ? parent.getFullText() : ''
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

// main loop
export function repl(prompt: string) {
  'use strict';
  rl.question(prompt, function (code: string) {
    if (/^:(type|doc)/.test(code)) {
      let identifier = code.split(' ')[1]
      if (!identifier) {
        console.log(':type command need names!'.red)
        return repl(prompt)
      }
      const ret = getType(identifier, code.indexOf('doc') === 1)
      if (ret) {
        console.log(colorize(ret))
      } else {
        console.log(`no info for "${identifier}" is found`.yellow)
      }
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
      multilineBuffer = ''
      context = createContext()
      return repl(defaultPrompt)
    }
    if (/^:print/.test(code)) {
      console.log(colorize(acceptedCodes))
      return repl(prompt)
    }
    if (/^:paste/.test(code) && !multilineBuffer) {
      return enterPasteMode()
    }
    if (/^:load/.test(code) && !multilineBuffer) {
      let files = (code.match(/\S+/g) || []).slice(1);
      if (files.length == 0) {
        console.log(':load: pass list of filenames to load'.red)
        return repl(prompt)
      }
      loadFiles(files)
      return repl(prompt)
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
