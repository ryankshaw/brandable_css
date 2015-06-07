import crypto from 'crypto'
import Promise from 'bluebird'
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

export function fileChecksum (filename) {
  return new Promise(function(resolve, reject){
    var hsh = newHash()
    var s = fs.ReadStream(filename)
    s.on('data', ::hsh.update)
    s.on('end', () => resolve(hsh.digest('hex')))
    s.on('error', reject)
  })
}

export function relativeFileChecksum(relativePath) {
  return fileChecksum(path.join(PATHS.sass_dir, relativePath))
}

export function fileChecksumSync (filename) {
  try {
    return checksum(fs.readFileSync(filename))
  } catch(e) {
    return ''
  }
}


