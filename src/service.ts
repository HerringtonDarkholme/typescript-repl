import * as ts from 'typescript'
import * as path from 'path'
import { readdirSync, existsSync, readFileSync, statSync } from 'fs'
import * as diff from 'diff'
import {assign} from './util'

// codes has been accepted by service, as opposed to codes in buffer and user input
// if some action fails to compile, acceptedCodes will be rolled-back
export var acceptedCodes = getInitialCommands()
// a counter indicating repl edition history, every action will increment it
var versionCounter = 0

function findConfigFile(searchPath: string) {
  while (true) {
    const fileName = path.join(searchPath, "tsconfig.json");
    if (existsSync(fileName)) {
      return fileName;
    }
    const parentPath = path.dirname(searchPath);
    if (parentPath === searchPath) {
      break;
    }
    searchPath = parentPath;
  }
  return undefined;
}

const CWD = process.cwd()

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES5,
  newLine: ts.NewLineKind.LineFeed,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  noUnusedLocals: false,
  configFilePath: path.join(CWD, 'tsconfig.json'),
}

// these option must be set in repl environment
const OVERRIDE_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.CommonJS,
  noEmitHelpers: true,
  noUnusedLocals: false,
  sourceMap: false,
  noEmit: false
}

function compileOption(): () => ts.CompilerOptions {
  let configFile = findConfigFile(process.cwd())
  if (!configFile) {
    return () => DEFAULT_OPTIONS
  }

  let configText = readFileSync(configFile, 'utf8')
  let result = ts.parseConfigFileTextToJson(configFile, configText)
  if (result.error) {
    return () => DEFAULT_OPTIONS
  }
  let optionOrError = ts.convertCompilerOptionsFromJson(
    result.config.compilerOptions,
    path.dirname(configFile)
  )
  if (optionOrError.errors.length) {
    return () => DEFAULT_OPTIONS
  }
  let options = optionOrError.options

  // override some impossible option
  assign(options, OVERRIDE_OPTIONS)
  return () => options
}

const resolvedOpt = compileOption()()
const DUMMY_FILE = resolvedOpt.rootDir ? resolvedOpt.rootDir + 'TSUN.repl.generated.ts': 'TSUN.repl.generated.ts'

var serviceHost: ts.LanguageServiceHost = {
  getCompilationSettings: compileOption(),
  getScriptFileNames: () => [DUMMY_FILE],
  getScriptVersion: (fileName) => {
    return fileName === DUMMY_FILE ? versionCounter.toString() : '1'
  },
  getScriptSnapshot: (fileName) => {
    try {
      var text = fileName === DUMMY_FILE
        ? acceptedCodes
        : readFileSync(fileName).toString()
      return ts.ScriptSnapshot.fromString(text)
    } catch(e) {
      return undefined
    }
  },
  getCurrentDirectory: () => CWD,
  getDirectories: ts.sys.getDirectories,
  directoryExists: ts.sys.directoryExists,
  getDefaultLibFileName: options => ts.getDefaultLibFilePath(options)
}

var service = ts.createLanguageService(serviceHost)

export var getDeclarations = (function() {
  var declarations: {[fileName: string]: {[name: string]: ts.DeclarationName[]}} = {}
  let declFiles = getDeclarationFiles()
  for (let file of declFiles) {
    let text = readFileSync(file, 'utf8')
    declarations[file] = collectDeclaration(ts.createSourceFile(file, text, ts.ScriptTarget.Latest))
  }
  return function(cached: boolean = false) {
    if (!cached) {
      declarations[DUMMY_FILE] = collectDeclaration(ts.createSourceFile(DUMMY_FILE, acceptedCodes, ts.ScriptTarget.Latest))
    }
    return declarations
  }
})()

function getDeclarationFiles() {
  var libPaths = [path.resolve(__dirname, '../../node_modules/@types/node/index.d.ts')]
  try {
    let typings = path.join(process.cwd(), './typings')
    let dirs = readdirSync(typings)
    for (let dir of dirs) {
      if (!/\.d\.ts$/.test(dir)) continue
      let p = path.join(typings, dir)
      if (statSync(p).isFile()) {
        libPaths.push(p)
      }
    }
  } catch(e) {
  }
  return libPaths
}

function getInitialCommands() {
  return getDeclarationFiles()
    .map(dir => `/// <reference path="${dir}" />\n`).join()
}

// private api hacks
function collectDeclaration(sourceFile: any): any {
  let decls = sourceFile.getNamedDeclarations()
  var ret: any = {}
  for (let decl in decls) {
    ret[decl] = Array.isArray(decls[decl]) && decls[decl].map((t: any) => t.name)
  }
  return ret
}


export function completer(line: string) {
  // append new line to get completions, then revert new line
  versionCounter++
  let originalCodes = acceptedCodes
  acceptedCodes += line
  if (':' === line[0]) {
    let candidates = ['type', 'detail', 'source', 'paste', 'clear', 'print', 'help']
    candidates = candidates.map(c => ':' + c).filter(c => c.indexOf(line) >= 0)
    return [candidates, line.trim()]
  }
  let completions = service.getCompletionsAtPosition(DUMMY_FILE, acceptedCodes.length)
  if (!completions) {
    acceptedCodes = originalCodes
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
  acceptedCodes = originalCodes
  return [candidates, prefix ? prefix[0] : line]
}

export function getType(name: string, detailed: boolean): string {
  versionCounter++
  let originalCodes = acceptedCodes
  acceptedCodes += '\n;' + name
  let typeInfo = service.getQuickInfoAtPosition(DUMMY_FILE, acceptedCodes.length -  1)
  let ret = ''
  if (typeInfo) {
    ret = detailed
      ? ts.displayPartsToString(typeInfo.documentation)
      : ts.displayPartsToString(typeInfo.displayParts)
  }
  acceptedCodes = originalCodes
  return ret
}

export function getDiagnostics(code: string): string[] {
  let fallback = acceptedCodes
  acceptedCodes += code
  versionCounter++
  let allDiagnostics = service.getCompilerOptionsDiagnostics()
    .concat(service.getSemanticDiagnostics(DUMMY_FILE))
  let ret = allDiagnostics.map(diagnostic => {
    let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    return message
  })
  if (ret.length) acceptedCodes = fallback
  return ret
}

let lastOutput = ''
export function getCurrentCode() {
  let emit = service.getEmitOutput(DUMMY_FILE)
  let output = emit.outputFiles[0].text
  let changes = diff.diffLines(lastOutput, output)
  let ret = changes.filter(c => c.added).map(c => c.value).join('\n')
  lastOutput = output
  return ret
}

export function testSyntacticError(code: string) {
  let fallback = acceptedCodes
  versionCounter++
  acceptedCodes += code
  let diagnostics = service.getSyntacticDiagnostics(DUMMY_FILE)
  acceptedCodes = fallback
  return diagnostics
}

export function clearHistory() {
  acceptedCodes = getInitialCommands()
  lastOutput = ''
}
