import path from 'path'
import Promise from 'bluebird'
import fs from 'fs-extra'
import {paths as PATHS} from "./config"
const readdirAsync = Promise.promisify(fs.readdir)


export function readJsonSync(filename) {
  try {
    return fs.readJsonSync(filename)
  } catch(e) {
    return {}
  }
}

export function folderForBrandId(brandId) {
  return path.join(PATHS.branded_scss_folder, brandId)
}

export function relativeSassPath (absPath) {
  return path.relative(path.join(process.env.PWD, PATHS.sass_dir), absPath)
}

export function isSassPartial (filePath) {
  return path.basename(filePath)[0] === '_'
}

export function onError (err){
  console.error('error compiling sass', err, err.stack, err.message)
  process.exit(1)
}


export function getBrandIds (){
  return readdirAsync(PATHS.branded_scss_folder).catch(() => [])
}