# TSUN - TypeScript Upgraded Node

TSUN, a TypeScript Upgraded Node, supports a REPL and interpreter for TypeScript.
When invoked without ts file argument, TSUN works as a repl where you can type in expression.
When you pass ts file to TSUN in command line argument, TSUN will automatically run it with invisible compilation.

Feature:
===
* TS 1.5 support
* Tab-completion support
* Multiple Line Mode
* Paste Mode
* Definition Lookup
* directly execute TypeScript application like `node`
* [Vim-Worksheet](https://github.com/HerringtonDarkholme/vim-worksheet) support
* And hidden feature for your exploration

Install:
===
`npm install -g tsun`

Usage:
====
* Use it as repl: `tsun`
* Use it as interpreter: `tsun path/to/app.ts`
* Other repl command can be accessed by typing `:help`
* Command Line options can be viewd by passing `-h` or `--help` option

Note:
===
When used as interpreter, tsun will create a temporary directory as output directory and create a node process to execute compiled js.
So it is usually a problem to correctly resolve `node_modules` path or definition file like `*.d.ts`.
Currently, tsun make two symbolic links for `node_modules` and `typings` directories in temporary directory, conventionally.

Custom definition files and JavaScript library support will be added in next releases.

ScreenShots:
===

Tab-completion
![Tab Completion](https://raw.githubusercontent.com/HerringtonDarkholme/typescript-repl/master/screenshot/completion.png)

Multiple Line Editing
![Multiple Line Editing](https://raw.githubusercontent.com/HerringtonDarkholme/typescript-repl/master/screenshot/block.png)

Paste Mode
![Paste Mode](https://raw.githubusercontent.com/HerringtonDarkholme/typescript-repl/master/screenshot/paste.png)

Definition Lookup
![Definition Lookup](https://raw.githubusercontent.com/HerringtonDarkholme/typescript-repl/master/screenshot/type.png)

And there is more for your exploration...

TODO:
===
* Add customization
* Add tsun config
