import Promise from 'bluebird'
import fs from 'fs-extra'
const outputFile = Promise.promisify(fs.outputFile)
const glob = Promise.promisify(require('glob'))
import zlib from 'zlib'
const gzip = Promise.promisify(zlib.gzip)
import path from 'path'
import _ from 'lodash'
import chalk from 'chalk'
import chokidar from 'chokidar'

import {checksum, relativeFileChecksum} from './checksum'
import compileSingleBundle from './compile-bundle'
import {debug, relativeSassPath, isSassPartial, folderForBrandId, onError} from './utils'
import {manifest_key_seperator, paths as PATHS} from './config'
import VARIANTS, {BRANDABLE_VARIANTS} from './variants'
import cache from './cache'
import writeDefaultBrandableVariablesScss from './write-brandable-variables-defaults-scss'
import parse from './parse'

function joined() {
  return [].join.call(arguments, manifest_key_seperator)
}

function getBrandIds() {
  try {
    return fs.readdirSync(PATHS.branded_scss_folder)
  } catch(e) {
    return []
  }
}

// This looks really crazy but it is the fastest way to find all the bundles
// that need to be rebuilt on startup
async function findChangedBundles(bundles, onlyCheckThisBrandId) {
  const changedFiles = new Set()
  const unchangedFiles = new Set()
  const toCompile = {}
  const brandIds = onlyCheckThisBrandId ? [onlyCheckThisBrandId] : getBrandIds()
  const variants = onlyCheckThisBrandId ? BRANDABLE_VARIANTS : VARIANTS

  function fasterHasFileChanged (filename) {
    debug('checking', filename)
    if (unchangedFiles.has(filename)) return false
    if (changedFiles.has(filename)) return true
    const iHaveChanged = hasFileChanged(filename)
    iHaveChanged ? changedFiles.add(filename) : unchangedFiles.add(filename)
    if (iHaveChanged) debug(filename, 'changed')
    return iHaveChanged
  }

  for (let bundleName of bundles) {
    for (let variant of variants){
      const cached = cache.bundles_with_deps.data[joined(bundleName, variant)]
      let thisVariantHasChanged = false
      if (!cached || !fs.existsSync(cssFilename({bundleName, variant, combinedChecksum: cached.combinedChecksum}))) {
        thisVariantHasChanged = true
        changedFiles.add(bundleName)
      } else {
        for (let filename of cached.includedFiles) {
          if (fasterHasFileChanged(filename)) {
            thisVariantHasChanged = true
            break
          }
        }
      }
      if (thisVariantHasChanged && !onlyCheckThisBrandId) {
        _.set(toCompile, [bundleName, variant, 'compileSelf'], true)
      }
      if (BRANDABLE_VARIANTS.has(variant)) {
        for (const brandId of brandIds) {
          const brandVarFile = relativeSassPath(path.join(folderForBrandId(brandId), '_brand_variables.scss'))
          let compileThisBrand = fasterHasFileChanged(brandVarFile) || thisVariantHasChanged
          if (!compileThisBrand) {
            const cachedBrand = cache.bundles_with_deps.data[joined(bundleName, variant, brandId)]
            compileThisBrand = !cachedBrand || !fs.existsSync(cssFilename({
              bundleName,
              variant,
              brandId,
              combinedChecksum: cachedBrand.combinedChecksum
            }))
          }
          if (compileThisBrand) {
            _.set(toCompile, [bundleName, variant, brandId], true)
          }
        }
      }
    }
  }
  return toCompile
}

export async function checkAll({brandId}){
  debug('checking all sass bundles to see if they need updating')
  await writeDefaultBrandableVariablesScss()
  const bundles = await glob(PATHS.all_sass_bundles).map(relativeSassPath)

  // remove any artifacts of bundles that are no longer on disk
  // TODO DO we really need this?
  // _(cache.bundles_with_deps).map(_.keys).flatten().uniq().without(...bundles).forEach(onBundleDeleted).value()

  const changedBundles = await findChangedBundles(bundles, brandId)
  if (_.isEmpty(changedBundles)) {
    console.info(chalk.green('no sass changes detected'))
    return
  }
  debug('these bundles have changed', changedBundles)
  return await processChangedBundles(changedBundles)
}

function processChangedBundles(changedBundles) {
  return Promise.all(_.map(changedBundles, async function(variants, bundleName) {
    let allOutputWillBeSame, sharedResult
    async function copyOrCompile({variant, brandId, unbrandedCombinedChecksum}) {
      if (allOutputWillBeSame) {
        debug('just copying', bundleName, variant, brandId)
        return writeCss({
          css: sharedResult.css,
          combinedChecksum: unbrandedCombinedChecksum || sharedResult.combinedChecksum,
          includedFiles: sharedResult.includedFiles,
          gzipped: sharedResult.gzipped,
          variant,
          bundleName,
          brandId
        })
      }
      const result = await compileBundle({variant, bundleName, brandId, unbrandedCombinedChecksum})
      if (typeof allOutputWillBeSame === 'undefined') {
        allOutputWillBeSame = !_.includes(result.includedFiles, relativeSassPath(PATHS.brandable_variables_defaults_scss))
        if (allOutputWillBeSame) sharedResult = result
      }
      return result
    }
    await* Object.keys(variants).map(async function (variant) {
      let unbrandedCombinedChecksum = sharedResult && sharedResult.combinedChecksum
      let compileSelf = variants[variant].compileSelf
      const brandIds = Object.keys(variants[variant]).filter(k => k != 'compileSelf')

      // The 'combinedChecksum' for the branded versions needs to be the same as the stock, unbranded result.
      // That is the only way we can load css dynamically in handlebars/js files.
      // so if we dont have one to use by now, we have to compileSelf anyway so we can use it.
      if (brandIds.length && !unbrandedCombinedChecksum) compileSelf = true
      if (compileSelf) unbrandedCombinedChecksum = (await copyOrCompile({variant})).combinedChecksum
      return await* brandIds.map(brandId => copyOrCompile({variant, brandId, unbrandedCombinedChecksum}))
    })
  })).then(cache.saveAll)
}

function getChecksum (relativePath) {
  let md5 = cache.file_checksums.data[relativePath]
  if (!md5) {
    md5 = relativeFileChecksum(relativePath)
    cache.file_checksums.update(relativePath, md5)
  }
}

async function compileBundle ({variant, bundleName, brandId, unbrandedCombinedChecksum}){
  if (brandId && !unbrandedCombinedChecksum) throw new Error('must provide unbrandedCombinedChecksum if compiling a branded bundle')
  const result = await compileSingleBundle({bundleName, variant, brandId})
  const includedFiles = result.includedFiles.map(relativeSassPath)
  if (watcher) {
    result.includedFiles.forEach(f => watcher.add(f))
  }

  const md5s = includedFiles.map(getChecksum)
  const combinedChecksum = brandId ? unbrandedCombinedChecksum : checksum(result.css + md5s)

  const buffered = new Buffer(result.css)
  // node 0.10 doesn't allow passing an options object
  const gzipped = await ( /^v0\.10/.test(process.version) ?
    gzip(buffered) :
    gzip(buffered, {level : zlib.Z_BEST_COMPRESSION})
  )
  const finalResult = {
    css: result.css,
    combinedChecksum,
    gzipped,
    variant,
    bundleName,
    brandId,
    includedFiles,
  }
  await writeCss(finalResult)
  return finalResult
}

function cssFilename({bundleName, variant, brandId, combinedChecksum}) {
  const {dir, name} = parse(bundleName)
  const outputDir = path.join(PATHS.output_dir, brandId || '', variant, dir)
  if (combinedChecksum) {
    return path.join(outputDir, `${name}-${combinedChecksum}.css`)
  } else {
    return path.join(outputDir, `${name}.css`)
  }
}

async function writeCss ({css, variant, bundleName, brandId, combinedChecksum, includedFiles, gzipped}) {
  const cacheKey = [bundleName, variant]
  if (brandId) cacheKey.push(brandId)
  cache.bundles_with_deps.update(joined(...cacheKey), {combinedChecksum, includedFiles})
  const filename = cssFilename({bundleName, variant, brandId, combinedChecksum})
  const filename_without_checksum = cssFilename({bundleName, variant, brandId})
  return await* [
    outputFile(filename, css),
    outputFile(filename_without_checksum, css),
    outputFile(filename + '.gz', gzipped)
  ]
}

function onBundleDeleted(bundleName) {
  cache.bundles_with_deps.clearMatching(bundleName)
  cache.file_checksums.update(bundleName, undefined)
}

async function onFilesystemChange(eventType, filePath, details){
  try {
    debug('onFilesystemChange', eventType, filePath, details.type)
    if (details.type != 'file' || details.event === 'unknown') return

    if (filePath.match(PATHS.brandable_variables_json)){
      debug(PATHS.brandable_variables_json, 'changed, saving to scss')
      return await writeDefaultBrandableVariablesScssFile()
    }
    filePath = relativeSassPath(filePath)

    if (eventType === 'deleted') {
      cache.file_checksums.update(filePath, undefined)
      if (!isSassPartial(filePath)) onBundleDeleted(filePath)
      debug('unwatching', filePath)
      watcher.unwatch(filePath)
      return
    }
    if (hasFileChanged(filePath)) {
      debug('changed contents', filePath)
      return await processChangedBundles(whatToCompileIfFileChanges(filePath))
    }
    debug('unchanged', filePath)
  } catch(e) {
    onError(e)
  }
}

function whatToCompileIfFileChanges (filename) {
  let toCompile = {}
  if (!isSassPartial(filename)) {
    for (const variant of VARIANTS) {
      _.set(toCompile, [bundleName, variant, 'compileSelf'], true)
    }
    if (BRANDABLE_VARIANTS.has(variant)) {
      for (const brandId of brandConfigs) {
        _.set(toCompile, [bundleName, variant, brandId], true)
      }
    }
  } else {
    for (const key in cache.bundles_with_deps.data) {
      if (_.includes(cache.bundles_with_deps.data[key].includedFiles, filename)) {
        const [bundleName, variant, brandId] = key.split(manifest_key_seperator)
        _.set(toCompile, [bundleName, variant, brandId || 'compileSelf'], true)
      }
    }
  }
  // TODO: still need to handle if a new _brand_variables.scss gets saved.
  // but maybe not because theme editor will explicitly run delayed job for that
  // so we don't need to catch it with a filesystem watcher
  // else if (is brand_variables.scss) {
  return toCompile
}

function hasFileChanged(relativePath) {
  const cached = cache.file_checksums.data[relativePath]
  const current = relativeFileChecksum(relativePath)
  cache.file_checksums.update(relativePath, current)
  return cached !== current
}

var watcher
const watched = new Set()
function watch(filename) {
  if (!watcher || watched.has(filename)) return
  watched.add(filename)
  watcher.add(filename)
}
function unwatch(filename) {
  if (!watcher || !watched.delete(filename)) return
  debug('unwatching', filename)
  watcher.unwatch(filename)
}
export function startWatcher() {
  debug('watching for changes to any scss files')
  watcher = chokidar
    .watch(PATHS.brandable_variables_json, {persistent: true, cwd: PATHS.sass_dir})
    .on('add', f => debug('file added to watcher', f))
    .add(PATHS.all_sass_bundles)

  for (const key in cache.bundles_with_deps.data) {
    cache.bundles_with_deps.data[key].includedFiles.forEach(watch)
  }
  watcher.on('raw', onFilesystemChange)
}
