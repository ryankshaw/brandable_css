export const debug = require('debug')('brandable_css')
import path from 'path'
import CONFIG from './config'

export function folderForBrandId (brandId) {
  return path.join(CONFIG.paths.branded_scss_folder, brandId)
}

export function relativeSassPath (absPath) {
  return path.relative(path.join(process.cwd(), CONFIG.paths.sass_dir), absPath)
}

export function isSassPartial (filePath) {
  return path.basename(filePath)[0] === '_'
}

export function onError (err) {
  console.error('error compiling sass', err, err.stack, err.message)
  process.exit(1)
}
