declare module 'readline' {
  interface ReadLineOptions {
    colorize: Function
  }
}

declare module 'node-color-readline' {
  import * as readline from 'readline'
  export =readline
}
