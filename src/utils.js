export const debug = require('debug')('brandable_css')
import path from 'path'
import fs from 'fs-extra'
import { paths as PATHS } from './config'

export function readJsonSync (filename) {
  debug('reading', filename)
  try {
    return fs.readJsonSync(filename)
  } catch (e) {
    debug("couldn't read", filename, 'using empty cache')
    return {}
  }
}

export function folderForBrandId (brandId) {
  return path.join(PATHS.branded_scss_folder, brandId)
}

export function relativeSassPath (absPath) {
  return path.relative(path.join(process.cwd(), PATHS.sass_dir), absPath)
}

export function isSassPartial (filePath) {
  return path.basename(filePath)[0] === '_'
}

export function onError (err) {
  console.error('error compiling sass', err, err.stack, err.message)
  process.exit(1)
}
