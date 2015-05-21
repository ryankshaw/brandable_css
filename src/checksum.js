import crypto from 'crypto'
import Promise from 'bluebird'
import fs from 'fs'
import versions from './versions'

function newHash() {
  let hash = crypto.createHash('md5')
  versions.forEach(::hash.update)
  return hash
}

export default function checksum (data) {
  return newHash().update(data).digest('hex')
}

export async function ofFile(filename) {
  return new Promise(function(resolve, reject){
    var hsh = newHash()
    var s = fs.ReadStream(filename)
    s.on('data', ::hsh.update)
    s.on('end', () => resolve(hsh.digest('hex')))
    s.on('error', resolve)
  })
}

export function ofFileSync(filename) {
  try {
    return checksum(fs.readFileSync(filename))
  } catch(e) {}
}


