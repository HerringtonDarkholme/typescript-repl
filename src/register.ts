import * as ts from 'typescript'
import * as fs from 'fs'

require.extensions['.ts'] = function(module: any, filename: string) {
  var text = fs.readFileSync(filename, 'utf8')
  module._compile(ts.transpile(text, {}, filename), filename)
}
