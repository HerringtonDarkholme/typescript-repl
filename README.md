# TSUN - TypeScript Upgraded Node

TSUN, a TypeScript Upgraded Node, supports a REPL and interpreter for TypeScript.

Feature:
===
* TS 1.5 support
* Tab-completion support
* directly execute TypeScript application like `node`

Install:
===
`npm install -g tsun`

Usage:
====
* Use it as repl: `tsun`
* Use it as interpreter: `tsun path/to/app.ts`

Note:
===
When used as interpreter, tsun will create a temporary directory as output directory and create a node process to execute compiled js.
So it is usually a problem to correctly resolve `node_modules` path or definition file like `*.d.ts`.
Currently, tsun make two symbolic links for `node_modules` and `typings` directories in temporary directory, conventionally.

Custom definition files and JavaScript library support will be added in next releases.

TODO:
===
* Add customization
* Add tsun config
* Add dere mode
