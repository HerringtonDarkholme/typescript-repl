/// <reference path='./typings/node.d.ts' />

import './src/register'

import {runCode} from './src/executor'
import {startRepl} from './src/repl'

var options = require('optimist')
  .usage(`A TypeScript REPL. Usage:
  ${'tsun'.blue} [options] [script.ts]`)
  .alias('h', 'help')
  .describe('h', 'Print this help message')
  .alias('o', 'out')
  .describe('o', 'output directory relative to temporary')
  .describe('dere', "I-its's not like I'm an option so DON'T GET THE WRONG IDEA!")

var argv = options.argv

if (argv._.length === 1) {
  runCode(argv)
}
if (argv.h) {
  options.showHelp()
  process.exit(1)
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
startRepl();
