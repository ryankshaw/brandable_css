import revHash from 'rev-hash'
import fs from 'fs'
import path from 'path'
import { paths as PATHS } from './config'

export function checksum (data) {
  if (typeof data === 'string') {
    data = new Buffer(data)
  }
  // we use revHash here because that is the same thing 'gulp-rev' uses
  return revHash(data)
}

export function relativeFileChecksum (relativePath) {
  return fileChecksumSync(path.join(PATHS.sass_dir, relativePath))
}

export function fileChecksumSync (filename) {
  try {
    return checksum(fs.readFileSync(filename))
  } catch(e) {
    return ''
  }
}
