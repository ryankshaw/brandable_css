import crypto from 'crypto'
import Promise from 'bluebird'
import fs from 'fs'

export default function checksum (data) {
  return crypto.createHash('md5').update(data).digest('hex')
}

export async function ofFile(filename) {
  return new Promise(function(resolve, reject){
    var hsh = crypto.createHash('md5')
    var s = fs.ReadStream(filename)
    s.on('data', (d) => hsh.update(d))
    s.on('end', () => resolve(hsh.digest('hex')))
    s.on('error', () => resolve())
  })
}

export function ofFileSync(filename) {
  try {
    return checksum(fs.readFileSync(filename))
  } catch(e) {}
}


