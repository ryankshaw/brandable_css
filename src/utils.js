import path from 'path'
import _ from 'lodash'
import Promise from 'bluebird'
import fs from 'fs-extra'
import PATHS from './paths'
import VARIANTS from './variants'

const unlink = Promise.promisify(fs.unlink)

export const glob = Promise.promisify(require('glob'))
export const readJson = Promise.promisify(fs.readJson)
export const outputJson = Promise.promisify(fs.outputJson)

export function readJsonSync(filename) {
  try {
    return fs.readJsonSync(filename)
  } catch(e) {
    return {}
  }
}

const MD5_PATTERN = _.repeat('[a-f0-9]', 32)

export function removePriorVersions (bundleName, variant) {
  const previousVersionsGlob = path.join(PATHS.output_dir, variant, `${bundleName}_${MD5_PATTERN}.css`)
  return glob(previousVersionsGlob).map(unlink)
}

export function relativeSassPath (absPath) {
  return path.relative(path.join(process.env.PWD, PATHS.sass_dir), absPath)
}

export function isSassPartial (filePath) {
  return path.basename(filePath)[0] === '_'
}
