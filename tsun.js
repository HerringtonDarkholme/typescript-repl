/// <reference path='./typings/node.d.ts' />
/// <reference path='./typings/colors.d.ts' />
/// <reference path='./typings/typescript.d.ts' />
var readline = require('readline');
var util = require('util');
var vm = require('vm');
var path = require('path');
var ConsoleModule = require('console');
var ts = require('typescript');
var fs = require('fs');
var colors = require('colors');
var child_process = require('child_process');
var Console = ConsoleModule.Console;
var builtinLibs = require('repl')._builtinLibs;
colors.setTheme({
    warn: 'red'
});
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
    .describe('dere', "I-its's not like I'm an option so DON'T GET THE WRONG IDEA!");
var argv = options.argv;
if (argv._.length === 1) {
    runCode();
}
if (argv.h) {
    options.showHelp();
    process.exit(1);
}
function runCode() {
    var temp = require('temp');
    temp.track();
    process.on('SIGINT', function () { return temp.cleanupSync(); });
    process.on('SIGTERM', function () { return temp.cleanupSync(); });
    var tempPath = temp.mkdirSync('tsrun');
    var outDir = tempPath;
    if (argv.o) {
        outDir = path.join(tempPath, argv.o);
    }
    var compileError = compile(argv._, {
        outDir: outDir,
        noEmitOnError: true,
        target: 1,
        module: 1,
    });
    if (compileError)
        process.exit(compileError);
    linkDir(process.cwd(), tempPath);
    var newArgv = process.argv.slice(2).map(function (arg) {
        if (!/\.ts$/.test(arg))
            return arg;
        return path.join(outDir, arg.replace(/ts$/, 'js'));
    });
    child_process.execFileSync('node', newArgv, {
        stdio: 'inherit'
    });
    process.exit();
}
function linkDir(src, dest) {
    var files = ['node_modules', 'typings'];
    for (var _i = 0; _i < files.length; _i++) {
        var file = files[_i];
        var srcpath = path.join(src, file);
        var destpath = path.join(dest, file);
        fs.symlinkSync(srcpath, destpath, 'dir');
    }
}
function compile(fileNames, options) {
    var program = ts.createProgram(fileNames, options);
    var emitResult = program.emit();
    var allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
    allDiagnostics.forEach(function (diagnostic) {
        var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        if (!diagnostic.file)
            return console.log(message);
        var _a = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start), line = _a.line, character = _a.character;
        console.log(diagnostic.file.fileName + " (" + (line + 1) + "," + (character + 1) + "): " + message);
    });
    var exitCode = emitResult.emitSkipped ? 1 : 0;
    return exitCode;
}
var defaultPrompt = '> ', moreLinesPrompt = '..';
var context = createContext();
var verbose = argv.v;
function getDeclarationFiles() {
    var libPaths = [path.resolve(__dirname, '../typings/node.d.ts')];
    if (argv.autoref) {
        try {
            var dirs = fs.readdirSync('typings');
            for (var _i = 0; _i < dirs.length; _i++) {
                var dir = dirs[_i];
                libPaths.push(path.join('typings', dir));
            }
        }
        catch (e) {
        }
    }
    return libPaths;
}
function getInitialCommands() {
    var codes = getDeclarationFiles().map(function (dir) { return ("/// <reference path=\"" + dir + "\" />"); });
    return codes.join('\n');
}
var versionCounter = 0;
var dummyFile = 'TSUN.repl.generated.ts';
var codes = getInitialCommands();
var buffer = '';
var rl = createReadLine();
var serviceHost = {
    getCompilationSettings: function () { return ({
        module: 1,
        target: 1
    }); },
    getScriptFileNames: function () { return [dummyFile]; },
    getScriptVersion: function (fileName) {
        return fileName === dummyFile && versionCounter.toString();
    },
    getScriptSnapshot: function (fileName) {
        try {
            var text = fileName === dummyFile
                ? codes
                : fs.readFileSync(fileName).toString();
            return ts.ScriptSnapshot.fromString(text);
        }
        catch (e) {
        }
    },
    getCurrentDirectory: function () { return process.cwd(); },
    getDefaultLibFileName: function (options) { return path.join(__dirname, '../node_modules/typescript/bin/lib.core.es6.d.ts'); }
};
var service = ts.createLanguageService(serviceHost, ts.createDocumentRegistry());
function createReadLine() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: function (line) {
            versionCounter++;
            var originalCodes = codes;
            codes += buffer + '\n' + line;
            if (':' === line[0]) {
                var candidates_1 = ['type', 'detail', 'source', 'paste', 'clear', 'print', 'help'];
                candidates_1 = candidates_1.map(function (c) { return ':' + c; }).filter(function (c) { return c.indexOf(line) >= 0; });
                return [candidates_1, line.trim()];
            }
            var completions = service.getCompletionsAtPosition(dummyFile, codes.length);
            if (!completions) {
                codes = originalCodes;
                return [[], line];
            }
            var prefix = /[A-Za-z_$]+$/.exec(line);
            var candidates = [];
            if (prefix) {
                var prefixStr = prefix[0];
                candidates = completions.entries.filter(function (entry) {
                    var name = entry.name;
                    return name.substr(0, prefixStr.length) == prefixStr;
                }).map(function (entry) { return entry.name; });
            }
            else {
                candidates = completions.entries.map(function (entry) { return entry.name; });
            }
            codes = originalCodes;
            return [candidates, prefix ? prefix[0] : line];
        }
    });
}
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
    builtinLibs.forEach(function (name) {
        Object.defineProperty(context, name, {
            get: function () {
                var lib = require(name);
                context[name] = lib;
                return lib;
            },
            set: function (val) {
                delete context[name];
                context[name] = val;
            },
            configurable: true
        });
    });
    return context;
}
var getDeclarations = (function () {
    var declarations = {};
    var declFiles = getDeclarationFiles().concat(path.join(__dirname, '../node_modules/typescript/bin/lib.core.es6.d.ts'));
    for (var _i = 0; _i < declFiles.length; _i++) {
        var file = declFiles[_i];
        var fileDeclarations = [];
        var namedDeclarations = service.getSourceFile(file).getNamedDeclarations();
        for (var i = 0; i < namedDeclarations.length; i++) {
            fileDeclarations.push(namedDeclarations[i]);
        }
        declarations[file] = fileDeclarations;
    }
    return function (cached) {
        if (cached === void 0) { cached = false; }
        if (!cached) {
            declarations[dummyFile] = service.getSourceFile(dummyFile).getNamedDeclarations().map(function (t) { return t.name; });
        }
        return declarations;
    };
})();
function getMemberInfo(member, file, parentDeclaration) {
    var pos = member.getEnd();
    var quickInfo = service.getQuickInfoAtPosition(file, pos);
    if (quickInfo)
        return ts.displayPartsToString(quickInfo.displayParts);
    var name = member.name && member.name.getText();
    if (!name)
        return member.getText();
    var declarations = getDeclarations(true)[file].filter(function (d) { return d.getText() === name; });
    for (var _i = 0; _i < declarations.length; _i++) {
        var decl = declarations[_i];
        var d = decl;
        if (parentDeclaration.parent.name.getText() == d.parent.parent.name.getText()) {
            var quickInfo_1 = service.getQuickInfoAtPosition(file, d.getEnd());
            return ts.displayPartsToString(quickInfo_1.displayParts);
        }
    }
    return member.getText();
}
function getTypeInfo(decl, file, detailed) {
    var pos = decl.getEnd();
    var ret = [("declaration in: " + file)];
    var quickInfo = service.getQuickInfoAtPosition(file, pos);
    ret.push(ts.displayPartsToString(quickInfo.displayParts));
    if (!detailed)
        return ret;
    var parentName = ret[1].split(' ')[1];
    var symbolType = quickInfo.displayParts[0].text;
    if (symbolType === 'interface' || symbolType === 'class') {
        var classLikeDeclaration = decl.parent;
        for (var _i = 0, _a = classLikeDeclaration.members; _i < _a.length; _i++) {
            var member = _a[_i];
            var memberInfo = getMemberInfo(member, file, decl).split('\n').map(function (mInfo) {
                mInfo = mInfo.replace(new RegExp(parentName + '\\.', 'g'), '');
                return '    ' + mInfo;
            });
            ret.push(memberInfo.join('\n'));
        }
    }
    return ret;
}
function getSource(name) {
    var declarations = getDeclarations();
    for (var file in declarations) {
        var names = declarations[file];
        var nameText = names.map(function (t) { return t.getText(); });
        if (nameText.indexOf(name) >= 0) {
            var decl = names[nameText.indexOf(name)];
            var pager = process.env.PAGER;
            var text = decl.parent.getFullText();
            if (!pager || text.split('\n').length < 24) {
                console.log(text);
                repl(defaultPrompt);
                return;
            }
            process.stdin.pause();
            var tty = require('tty');
            tty.setRawMode(false);
            var temp = require('temp');
            var tempFile = temp.openSync('dummyFile' + Math.random());
            fs.writeFileSync(tempFile.path, text);
            var display = child_process.spawn('less', [tempFile.path], {
                'stdio': [0, 1, 2]
            });
            display.on('exit', function () {
                temp.cleanupSync();
                tty.setRawMode(true);
                process.stdin.resume();
                repl(defaultPrompt);
            });
            return;
        }
    }
    console.log(("identifier " + name + " not found").yellow);
}
function getType(name, detailed) {
    var declarations = getDeclarations();
    for (var file in declarations) {
        var names = declarations[file];
        var nameText = names.map(function (t) { return t.getText(); });
        if (nameText.indexOf(name) >= 0) {
            var decl = names[nameText.indexOf(name)];
            var infoString = getTypeInfo(decl, file, detailed);
            console.log(infoString.join('\n').cyan);
            return;
        }
    }
    console.log(("identifier " + name + " not found").yellow);
}
function printHelp() {
    console.log("\ntsun repl commands\n:type symbol       print the type of an identifier\n:detail symbol     print details of identifier\n:source symbol     print source of identifier\n:clear             clear all the code\n:print             print code input so far\n:help              print this manual\n:paste             enter paste mode".blue);
    if (argv.dere) {
        console.log(':baka              Who would like some pervert like you, baka~'.blue);
    }
}
function getDiagnostics() {
    var emit = service.getEmitOutput(dummyFile);
    var allDiagnostics = service.getCompilerOptionsDiagnostics()
        .concat(service.getSyntacticDiagnostics(dummyFile))
        .concat(service.getSemanticDiagnostics(dummyFile));
    allDiagnostics.forEach(function (diagnostic) {
        var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        console.warn(message.red.bold);
    });
    return allDiagnostics;
}
function startEvaluate(code) {
    buffer = '';
    var fallback = codes;
    codes += code;
    versionCounter++;
    var allDiagnostics = getDiagnostics();
    if (allDiagnostics.length) {
        codes = fallback;
        if (defaultPrompt != '> ') {
            console.log('');
            console.log(defaultPrompt, 'URUSAI URUSAI URUSAI'.magenta);
            console.log('');
        }
        return repl(defaultPrompt);
    }
    var current = ts.transpile(code);
    if (code.trim().substr(0, 6) === 'import' && !current.trim()) {
        current = code.replace(/^\s*import/, 'var');
    }
    if (verbose) {
        console.log(current.green);
    }
    try {
        var result = vm.runInContext(current, context);
        console.log(util.inspect(result, false, 2, true));
    }
    catch (e) {
        console.log(e.stack);
    }
}
function waitForMoreLines(code, indentLevel) {
    if (/\n{2}$/.test(code)) {
        console.log('You typed two blank lines! start new command'.yellow);
        buffer = '';
        return repl(defaultPrompt);
    }
    var nextPrompt = '';
    for (var i = 0; i < indentLevel; i++) {
        nextPrompt += moreLinesPrompt;
    }
    buffer = code;
    repl(nextPrompt);
}
function replLoop(prompt, code) {
    code = buffer + '\n' + code;
    var openCurly = (code.match(/\{/g) || []).length;
    var closeCurly = (code.match(/\}/g) || []).length;
    var openParen = (code.match(/\(/g) || []).length;
    var closeParen = (code.match(/\)/g) || []).length;
    if (openCurly === closeCurly && openParen === closeParen) {
        startEvaluate(code);
        repl(defaultPrompt);
    }
    else {
        var indentLevel = openCurly - closeCurly + openParen - closeParen;
        waitForMoreLines(code, indentLevel);
    }
}
function addLine(line) {
    buffer += '\n' + line;
}
function enterPasteMode() {
    console.log('// entering paste mode, press ctrl-d to evaluate'.cyan);
    console.log('');
    var oldPrompt = defaultPrompt;
    rl.setPrompt('');
    rl.on('line', addLine);
    rl.once('close', function (d) {
        console.log('evaluating...'.cyan);
        rl.removeListener('line', addLine);
        startEvaluate(buffer);
        rl = createReadLine();
        repl(defaultPrompt = oldPrompt);
    });
}
function repl(prompt) {
    'use strict';
    rl.question(prompt, function (code) {
        if (/^:(type|detail)/.test(code)) {
            var identifier = code.split(' ')[1];
            if (!identifier) {
                console.log(':type|detail command need names!'.red);
                return repl(prompt);
            }
            getType(identifier, code.indexOf('detail') === 1);
            return repl(prompt);
        }
        if (/^:source/.test(code)) {
            var identifier = code.split(' ')[1];
            if (!identifier) {
                console.log(':source command need names!'.red);
                return repl(prompt);
            }
            getSource(identifier);
            return;
        }
        if (/^:help/.test(code)) {
            printHelp();
            return repl(prompt);
        }
        if (/^:clear/.test(code)) {
            codes = getInitialCommands();
            buffer = '';
            context = createContext();
            return repl(defaultPrompt);
        }
        if (/^:print/.test(code)) {
            console.log(codes);
            return repl(prompt);
        }
        if (/^:paste/.test(code) && !buffer) {
            return enterPasteMode();
        }
        if (argv.dere && /^:baka/.test(code)) {
            defaultPrompt = 'ξ(ﾟ⊿ﾟ)ξ> ';
            moreLinesPrompt = 'ζ(///*ζ) ';
            return repl(defaultPrompt);
        }
        replLoop(prompt, code);
    });
}
if (!argv.dere) {
    console.log('TSUN'.blue, ': TypeScript Upgraded Node');
    console.log('type in TypeScript expression to evaluate');
    console.log('type', ':help'.blue.bold, 'for commands in repl');
}
else {
    console.log('TSUN'.magenta, " I'm- I'm not making this repl because I like you or anything!");
    console.log("don'... don't type ", ':help'.magenta.bold, ', okay? Idiot!');
}
console.log('');
repl(defaultPrompt);
