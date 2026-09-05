import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const cache = new Map()
export function loadTs(relativePath) {
  const filename = path.resolve(relativePath)
  if (cache.has(filename)) return cache.get(filename)
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX,
  } })
  const module = { exports: {} }
  const localRequire = (specifier) => {
    if (!specifier.startsWith('.')) return require(specifier)
    const target = path.resolve(path.dirname(filename), specifier)
    const resolved = [target, `${target}.ts`, `${target}.tsx`].find((candidate) => fs.existsSync(candidate))
    if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${filename}`)
    return loadTs(resolved)
  }
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`, { filename })(localRequire, module, module.exports)
  cache.set(filename, module.exports)
  return module.exports
}
