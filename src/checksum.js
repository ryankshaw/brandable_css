import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import versions from './versions'
import {paths as PATHS} from './config'


function newHash() {
  let hash = crypto.createHash('md5')
  versions.forEach(::hash.update)
  return hash
}

export function checksum (data) {
  return newHash().update(data).digest('hex')
}

export function relativeFileChecksum(relativePath) {
  return fileChecksumSync(path.join(PATHS.sass_dir, relativePath))
}

export function fileChecksumSync (filename) {
  try {
    return checksum(fs.readFileSync(filename))
  } catch(e) {
    return ''
  }
}


