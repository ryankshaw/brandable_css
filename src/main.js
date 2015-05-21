import Promise from 'bluebird'
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const writeFileAsync = Promise.promisify(require('fs').writeFile)
const debug = require('debug')('canvas_css')
import path from 'path'
import _ from 'lodash'
import chalk from 'chalk'
import chokidar from 'chokidar'
import checksum, {ofFile} from './checksum'
import compileSingleBundle from './compile-bundle'
import {removePriorVersions, relativeSassPath, isSassPartial, readJson, outputJson, glob} from './utils'
import PATHS from './paths'
import VARIANTS from './variants'
import cache from './cache'

export function onError(err){
  console.error('error compiling sass', err, err.stack)
  process.exit(1)
}

  // TODO: need to handle this case
  // You can run this with with `node script/compile-sass.js app/stylesheets/jst/something.scss to compile a specific file.
  // var sassFileToConvert = process.argv[2]
  // var sassFiles = sassFileToConvert ? [sassFileToConvert] : glob.sync(globPattern)

// this looks really crazy but it is the fastest way to find all the bundles that need to be rebuilt on startup
async function findChangedBundles(bundles) {
  let changedFiles = new Set()
  let unchangedFiles = new Set()
  let changedBundles = new Set()
  async function updateChecksum (filename) {
    const md5 = await fileChecksum(filename)
    if (cache.file_checksums.data[filename] === md5) {
      unchangedFiles.add(filename)
    } else {
      cache.file_checksums.update(filename, md5)
    }
    return md5
  }
  for (let bundleName of bundles) {
    outer:
    for (let variant of VARIANTS){
      let cached = _.get(cache.bundles_with_deps.data, [variant, bundleName])
      if (!cached) {
        changedBundles.add(bundleName)
        changedFiles.add(bundleName)
        break outer
      } else {
        for (let filename of cached.includedFiles) {
          if (!unchangedFiles.has(filename) && (
            changedFiles.has(filename) ||
            !cache.file_checksums.data[filename] ||
            cache.file_checksums.data[filename] != await updateChecksum(filename)
          )) {
            changedBundles.add(bundleName)
            changedFiles.add(filename)
            break outer
          }
        }
      }
    }
  }
  return [...changedBundles]
}

export async function checkAll(){
  debug('checking all sass bundles to see if they need updating')
  await writeDefaultBrandableVariablesScss()
  const bundles =(await glob(PATHS.all_sass_bundles)).map(relativeSassPath)
  // remove any artifacts of bundles that are no longer on disk
  _(cache.bundles_with_deps).map(_.keys).flatten().uniq().without(...bundles).forEach(onBundleDeleted).value()

  const changedBundles = await findChangedBundles(bundles)
  if (changedBundles.length) {
    debug('these bundles have changed', changedBundles)
    changedBundles.forEach(markAsChanged)
  } else {
    console.info(chalk.green('no changes detected'))
  }
}

function fileChecksum(relativePath) {
  return ofFile(path.join(PATHS.sass_dir, relativePath))
}

async function checksumIsUpToDate(file) {
  return cache.file_checksums.data[file] && cache.file_checksums.data[file] === await fileChecksum(file)
}

async function needsUpdate(variant, bundleName) {
  const includedFiles = _.get(cache, ['bundles_with_deps', 'data', variant, bundleName, 'includedFiles'])
  if (!includedFiles) return true
  for (let filename of includedFiles) {
    if (! await checksumIsUpToDate(filename)) return true
  }
  return false
}

async function getChecksum (relativePath) {
  let md5 = cache.file_checksums.data[relativePath]
  if (!md5) {
    md5 = await fileChecksum(relativePath)
    cache.file_checksums.update(relativePath, md5)
  }
}

async function compileBundle(variant, bundleName){
  const {dir, name} = path.parse(bundleName)
  const outputDir = path.join(PATHS.output_dir, variant, dir)
  const [result] = await* [
    compileSingleBundle({bundleName, variant}),
    removePriorVersions(bundleName, variant),
    mkdirpAsync(outputDir)
  ]
  const includedFiles = result.includedFiles.map(relativeSassPath)
  if (watcher) {
    result.includedFiles.forEach(f => watcher.add(f))
  }
  const md5s = await Promise.all(includedFiles.map(getChecksum))
  const combinedChecksum = checksum(result.css + md5s)
  _.set(cache, ['bundles_with_deps', 'data', variant, bundleName], {combinedChecksum, includedFiles})
  return await writeFileAsync(path.join(outputDir, `${name}_${combinedChecksum}.css`), result.css)
}

function onBundleDeleted(bundleName) {
  for (var variant in cache.bundles_with_deps.data) {
    delete cache.bundles_with_deps.data[variant][bundleName]
  }
  cache.file_checksums.update(bundleName, undefined)
  return Promise.all(VARIANTS.map(removePriorVersions.bind(null, bundleName)))
}

async function onFilesystemChange(eventType, filePath, details){
  debug('onFilesystemChange', eventType, filePath)
  if (details.type != 'file' || details.event == 'unknown') return

  if (filePath.match(PATHS.brandable_variables_json)){
    return writeDefaultBrandableVariablesScssFile()
  }
  filePath = relativeSassPath(filePath)

  if (eventType === 'deleted') {
    cache.file_checksums.update(filePath, undefined)
    if (!isSassPartial(filePath)) onBundleDeleted(filePath)
    debug('unwatching', filePath)
    watcher.unwatch(filePath)
    return
  }
  if (!await checksumIsUpToDate(filePath)) {
    markAsChanged(filePath)
  }
}

var markAsChanged = (function(){
  const seperator = '$$$$$'
  var changedFiles = new Set()
  var timerId

  async function processChangedFiles() {
    let bundlesToBuild = new Set()
    for (let filePath of changedFiles) {
      let isBundleRoot = !isSassPartial(filePath)
      for (let variant of VARIANTS) {
        if (isBundleRoot) {
          bundlesToBuild.add(variant + seperator + filePath)
        }
        for (var bundleName in cache.bundles_with_deps.data[variant]) {
          if (_.contains(cache.bundles_with_deps.data[variant][bundleName].includedFiles, filePath)) {
            bundlesToBuild.add(variant + seperator + bundleName)
          }
        }
      }
    }
    changedFiles.clear()
    timerId = undefined

    await Promise.all([...bundlesToBuild].map(function(key){
      let [variant, bundleName] = key.split('$$$$$')
      debug('compiling', variant, bundleName)
      return compileBundle(variant, bundleName)
    }))
    debug('finished')

    return await cache.saveAll()
  }

  return function markAsChanged(filename) {
    changedFiles.add(filename)
    if (!timerId) timerId = setTimeout(function(){
      processChangedFiles().catch(onError)
    }, 50)
  }
})()

async function updateChecksum(relativePath) {
  let newMd5 = await fileChecksum(relativePath)
  cache.file_checksums.update(relativeSassPath, newMd5)
}

async function writeDefaultBrandableVariablesScss(){
  let fileContents = "// THIS FILE IS AUTOGENERATED by compile-sass. Make changes to: " + PATHS.brandable_variables_json
  let variableGrous = await readJson(PATHS.brandable_variables_json)
  variableGrous.forEach( variableGroup => {
    variableGroup.variables.forEach( variable => {
      let value = variable.default
      if (variable.type === 'image') value = 'url("'+value+'")'
      fileContents += '\n$'+variable.variable_name+': '+value+';'
    })
  })
  return await outputJson(PATHS.brandable_variables_defaults_scss, fileContents)
}

var watcher
export function watch() {
  debug('watching for changes to any scss files')
  watcher = chokidar
    .watch(PATHS.brandable_variables_json, {persistent: true, cwd: PATHS.sass_dir})
    .on('add', function(filename){ debug('file added to watcher', filename)})
    .add(PATHS.all_sass_bundles)

  for (var variant in cache.bundles_with_deps.data) {
    for (var bundleName in cache.bundles_with_deps.data[variant]) {
      for (let filename of cache.bundles_with_deps.data[variant][bundleName].includedFiles) {
        debug('adding', filename)
        watcher.add(filename)
      }
    }
  }
  watcher.on('raw', () => onFilesystemChange().catch(onError))
}
