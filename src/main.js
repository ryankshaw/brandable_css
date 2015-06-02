const debug = require('debug')('canvas_css')
import Promise from 'bluebird'
const outputFile = Promise.promisify(require('fs-extra').outputFile)
const glob = Promise.promisify(require('glob'))
import zlib from 'zlib'
const gzip = Promise.promisify(zlib.gzip)
import path from 'path'
import _ from 'lodash'
import chalk from 'chalk'
import chokidar from 'chokidar'

import {checksum, relativeFileChecksum} from './checksum'
import compileSingleBundle from './compile-bundle'
import {relativeSassPath, isSassPartial, folderForBrandId, getBrandIds, onError} from './utils'
import {manifest_key_seperator, paths as PATHS} from './config'
import VARIANTS, {BRANDABLE_VARIANTS} from './variants'
import cache from './cache'
import writeDefaultBrandableVariablesScss from './write-brandable-variables-defaults-scss'


// This looks really crazy but it is the fastest way to find all the bundles
// that need to be rebuilt on startup
async function findChangedBundles(bundles) {
  let changedFiles = new Set()
  let unchangedFiles = new Set()
  let toCompile = {}
  const brandIds = await getBrandIds()

  async function fasterHasFileChanged (filename) {
    if (unchangedFiles.has(filename)) return false
    if (changedFiles.has(filename)) return true
    const iHaveChanged = await hasFileChanged(filename)
    iHaveChanged ? changedFiles.add(filename) : unchangedFiles.add(filename)
    return iHaveChanged
  }

  for (let bundleName of bundles) {
    for (let variant of VARIANTS){
      const cached = cache.bundles_with_deps.data[[bundleName, variant].join(manifest_key_seperator)]
      let thisVariantHasChanged = false
      if (!cached) {
        thisVariantHasChanged = true
        changedFiles.add(bundleName)
      } else {
        for (let filename of cached.includedFiles) {
          if (await fasterHasFileChanged(filename)) {
            thisVariantHasChanged = true
            break
          }
        }
      }
      if (thisVariantHasChanged) {
        _.set(toCompile, [bundleName, variant, 'compileSelf'], true)
      }
      if (BRANDABLE_VARIANTS.has(variant)) {
        for (const brandId of brandIds) {
          const brandVarFile = relativeSassPath(path.join(folderForBrandId(brandId), '_brand_variables.scss'))
          if (thisVariantHasChanged || await fasterHasFileChanged(brandVarFile)) {
            _.set(toCompile, [bundleName, variant, brandId], true)
          }
        }
      }
    }
  }
  return toCompile
}

export async function checkAll(){
  debug('checking all sass bundles to see if they need updating')
  await writeDefaultBrandableVariablesScss()
  const bundles = await glob(PATHS.all_sass_bundles).map(relativeSassPath)

  // remove any artifacts of bundles that are no longer on disk
  // TODO DO we really need this?
  // _(cache.bundles_with_deps).map(_.keys).flatten().uniq().without(...bundles).forEach(onBundleDeleted).value()

  const changedBundles = await findChangedBundles(bundles)
  if (_.isEmpty(changedBundles)) {
    console.info(chalk.green('no sass changes detected'))
    return
  }
  debug('these bundles have changed', changedBundles)
  return await processChangedBundles(changedBundles)
}

function processChangedBundles(changedBundles) {
  return Promise.all(_.map(changedBundles, async function(variants, bundleName) {
    // compile the first variant of this bundle and if it doesn't include our custom 'variables' stuff
    // we can just use that same result for all the other variants of this bundle
    const firstUnbranded = _.find(Object.keys(variants), k => variants[k].compileSelf)
    let firstResult, allOutputWillBeSame
    if (firstUnbranded) {
      firstResult = await compileBundle({variant: firstUnbranded, bundleName})
      allOutputWillBeSame = !_.includes(firstResult.includedFiles, relativeSassPath(PATHS.brandable_variables_defaults_scss))
    }
    function copyOrCompile({variant, brandId, unbrandedCombinedChecksum}) {
      if (allOutputWillBeSame) {
        debug('just copying since it was same as first', bundleName, variant, brandId)
        return writeCss({
          css: firstResult.css,
          combinedChecksum: firstResult.combinedChecksum,
          includedFiles: firstResult.includedFiles,
          gzipped: firstResult.gzipped,
          variant,
          bundleName,
          brandId
        })
      }
      debug('combinde5', arguments)
      return compileBundle({variant, bundleName, brandId, unbrandedCombinedChecksum})
    }
    await* Object.keys(variants).map(async function (variant) {
      let unbrandedCombinedChecksum  = (allOutputWillBeSame && firstResult.combinedChecksum)

      // Don't recompile bundle if it was the first one we did above.
      if (variant !== firstUnbranded && variants[variant].compileSelf) {
        unbrandedCombinedChecksum = (await copyOrCompile({variant})).combinedChecksum
      }
      // The 'combinedChecksum' for the branded versions needs to be the same as the stock, unbranded result.
      // That is the only way we can load css dynamically in handlebars/js files.
      if (!unbrandedCombinedChecksum) {
        unbrandedCombinedChecksum = cache.bundles_with_deps.data[[bundleName, variant].join(manifest_key_seperator)]
      }
      await* Object.keys(variants[variant]).map((brandId) => {
        return (brandId !== 'compileSelf') && copyOrCompile({variant, brandId, unbrandedCombinedChecksum})
      })
    })
  })).then(cache.saveAll)
}


async function getChecksum (relativePath) {
  let md5 = cache.file_checksums.data[relativePath]
  if (!md5) {
    md5 = await relativeFileChecksum(relativePath)
    cache.file_checksums.update(relativePath, md5)
  }
}

async function compileBundle ({variant, bundleName, brandId, unbrandedCombinedChecksum}){
  const result = await compileSingleBundle({bundleName, variant, brandId})
  const includedFiles = result.includedFiles.map(relativeSassPath)
  if (watcher) {
    result.includedFiles.forEach(f => watcher.add(f))
  }

  let combinedChecksum
  if (brandId) {
    if (!unbrandedCombinedChecksum) throw new Error('must provide unbrandedCombinedChecksum if compiling a branded bundle' + variant + bundleName + brandId + unbrandedCombinedChecksum )
    combinedChecksum = unbrandedCombinedChecksum
  } else {
    const md5s = Promise.all(includedFiles.map(getChecksum))
    combinedChecksum = checksum(result.css + md5s)
  }

  const gzipped = await gzip(new Buffer(result.css), {level : zlib.Z_BEST_COMPRESSION})
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

async function writeCss ({css, variant, bundleName, brandId, combinedChecksum, includedFiles, gzipped}) {
  const {dir, name} = path.parse(bundleName)
  const outputDir = path.join(PATHS.output_dir, brandId || '', variant, dir)
  const filename = path.join(outputDir, `${name}-${combinedChecksum}.css`)
  const cacheKey = [bundleName, variant]
  if (brandId) cacheKey.push(brandId)
  cache.bundles_with_deps.update(cacheKey.join(manifest_key_seperator), {combinedChecksum, includedFiles})
  return await* [
    outputFile(filename, css),
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
    if (await hasFileChanged(filePath)) {
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

async function hasFileChanged(relativePath) {
  const cached = cache.file_checksums.data[relativePath]
  const current = await relativeFileChecksum(relativePath)
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
