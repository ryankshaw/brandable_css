import {promisify} from 'bluebird'
import fs from 'fs-extra-promise'
const glob = promisify(require('glob'))
import path from 'path'
import _ from 'lodash'
import chalk from 'chalk'
import chokidar from 'chokidar'
import {checksum, relativeFileChecksum} from './checksum'
import compileSingleBundle from './compileBundle'
import {debug, relativeSassPath, isSassPartial, onError} from './utils'
import {manifest_key_seperator, paths as PATHS} from './config'
import VARIANTS, {BRANDABLE_VARIANTS} from './variants'
import cache from './cache'
import limitConcurrency from './limitConcurrency'
import writeDefaultBrandableVariablesScss from './writeDefaultBrandableVariablesScss'
import s3Bucket from './s3Bucket'

function getBrandIds () {
  try {
    return fs.readdirSync(PATHS.branded_scss_folder)
  } catch (e) {
    return []
  }
}

function cacheKey (bundleName, variant) {
  return [bundleName, variant].join(manifest_key_seperator)
}

function cacheFor (bundleName, variant) {
  return cache.bundles_with_deps.data[cacheKey(bundleName, variant)]
}

export function allFingerprintsFor (bundleName) {
  return VARIANTS.reduce((accumulator, variant) => {
    const cached = cacheFor(bundleName, variant)
    if (cached) accumulator[variant] = cached
    return accumulator
  }, {})
}

function cssFileExists ({bundleName, variant, /* optional */ brandId, combinedChecksum, includesNoVariables}) {
  const filename = cssFilename({bundleName, variant, brandId, combinedChecksum, includesNoVariables})
  return (s3Bucket
    ? s3Bucket.objectExists(cdnObjectName(filename))
    : fs.existsAsync(filename)
  )
}

// This is a fast way to find all the bundles that need to be rebuilt on startup
async function findChangedBundles (bundles, onlyCheckThisBrandId) {
  const changedFiles = new Set()
  const unchangedFiles = new Set()
  const toCompile = {}
  const brandIds = onlyCheckThisBrandId ? [onlyCheckThisBrandId] : getBrandIds()
  const variantsToCheck = onlyCheckThisBrandId ? [...BRANDABLE_VARIANTS] : VARIANTS

  function fasterHasFileChanged (filename) {
    // debug('fasterHasFileChanged', filename)
    if (unchangedFiles.has(filename)) return false
    if (changedFiles.has(filename)) return true
    const iHaveChanged = hasFileChanged(filename)
    iHaveChanged ? changedFiles.add(filename) : unchangedFiles.add(filename)
    if (iHaveChanged) debug(filename, 'changed')
    return iHaveChanged
  }

  await* bundles.map(async function (bundleName) {
    let includesNoVariables
    await* variantsToCheck.map(async function (variant) {
      if (includesNoVariables) return
      let thisVariantHasChanged = false
      const cached = cacheFor(bundleName, variant)
      debug('cached was', bundleName, variant, cached)
      if (!cached) {
        thisVariantHasChanged = true
        changedFiles.add(bundleName)
      } else {
        if (cached.includesNoVariables) includesNoVariables = true

        // check all files on disk included in this bundle to see if the've changed
        for (let filename of cached.includedFiles) {
          if (fasterHasFileChanged(filename)) {
            thisVariantHasChanged = true
            break
          }
        }

        // check to actually make sure the css file exists
        if (!thisVariantHasChanged && !(await cssFileExists({
          bundleName,
          variant,
          combinedChecksum: cached.combinedChecksum,
          includesNoVariables: cached.includesNoVariables
        }))) {
          thisVariantHasChanged = true
        }
      }
      if (thisVariantHasChanged) {
        _.set(toCompile, [bundleName, variant, 'compileSelf'], true)
      }
      if (!includesNoVariables && BRANDABLE_VARIANTS.has(variant)) {
        for (const brandId of brandIds) {
          if (thisVariantHasChanged || !(await cssFileExists({
            bundleName,
            variant,
            brandId,
            combinedChecksum: cached.combinedChecksum,
            includesNoVariables: cached.includesNoVariables
          }))) {
            _.set(toCompile, [bundleName, variant, brandId], true)
          }
        }
      }
    })
  })
  return toCompile
}

export async function checkAll ({brandId}) {
  debug('checking all sass bundles to see if they need updating')
  await writeDefaultBrandableVariablesScss()
  const bundles = await glob(PATHS.all_sass_bundles).map(relativeSassPath)
  const changedBundles = await findChangedBundles(bundles, brandId)
  if (_.isEmpty(changedBundles)) {
    console.info(chalk.green('no sass changes detected'))
    return
  }
  debug('these bundles have changed', changedBundles)
  return await processChangedBundles(changedBundles)
}

async function processChangedBundles (changedBundles) {
  debug('processing these bundles', changedBundles)

  await* _.map(changedBundles, async function(variants, bundleName) {
    let includesNoVariables

    async function compileUnlessIncludesNoVariables ({variant, brandId, unbrandedCombinedChecksum}) {
      if (includesNoVariables) return
      const result = await compileBundle({variant, bundleName, brandId, unbrandedCombinedChecksum})
      if (typeof includesNoVariables === 'undefined') {
        includesNoVariables = result.includesNoVariables
        if (includesNoVariables) {
          VARIANTS.forEach(variant => updateCache(_.defaults({variant}, result)))
        }
      }
      return result
    }

    await* Object.keys(variants).map(async function (variant) {
      if (includesNoVariables) return
      let unbrandedCombinedChecksum
      let compileSelf = variants[variant].compileSelf
      const brandIds = Object.keys(variants[variant]).filter(k => k !== 'compileSelf')

      // The 'combinedChecksum' for the branded versions needs to be the same as the stock, unbranded result.
      // That is the only way we can load css dynamically in handlebars/js files.
      // so if we dont have one to use by now, we have to compileSelf anyway so we can use it.
      if (!compileSelf && brandIds.length && !unbrandedCombinedChecksum) {
        let cached = cache.bundles_with_deps.data[cacheKey(bundleName, variant)]
        if (cached) {
          unbrandedCombinedChecksum = cached.combinedChecksum
        } else {
          compileSelf = true
        }
      }

      if (compileSelf) unbrandedCombinedChecksum = (await compileUnlessIncludesNoVariables({variant})).combinedChecksum
      await* brandIds.map(brandId => compileUnlessIncludesNoVariables({variant, brandId, unbrandedCombinedChecksum}))
    })
  })
  cache.saveAll()
}

function getChecksum (relativePath) {
  let md5 = cache.file_checksums.data[relativePath]
  if (!md5) {
    md5 = relativeFileChecksum(relativePath)
    cache.file_checksums.update(relativePath, md5)
  }
}

// We don't want to just fire off all the work at the same time because we're CPU contstrained anyway
// and it will just cause it to consume a ton of memory, so just do 60 at a time. that'll be plenty
// to keep the CPU busy.
const concurrency = parseInt(process.env.BRANDABLE_CSS_CONCURRENCY, 10) || 60
const compileBundle = limitConcurrency(concurrency, async function ({variant, bundleName, brandId, unbrandedCombinedChecksum}) {
  if (brandId && !unbrandedCombinedChecksum) throw new Error('must provide unbrandedCombinedChecksum if compiling a branded bundle')

  // Even if we still think we need to generate a branded css bundle, it might already exist.
  // If it does we have enough info now to know with certainty if we can skip.
  if (brandId && await cssFileExists({bundleName, variant, brandId, combinedChecksum: unbrandedCombinedChecksum})) {
    const msg = chalk.cyan(bundleName, variant, brandId, unbrandedCombinedChecksum, 'already exists.')
    if (process.env.BRANDABLE_CSS_FORCE_UPLOAD_EVEN_IF_EXISTS) {
      console.info(chalk.magenta('force generating', msg, 'since you set BRANDABLE_CSS_FORCE_UPLOAD_EVEN_IF_EXISTS'))
    } else {
      console.info(chalk.gray('skipping:', msg, 'set BRANDABLE_CSS_FORCE_UPLOAD_EVEN_IF_EXISTS to generate anyway'))
      return {variant, bundleName, brandId, unbrandedCombinedChecksum}
    }
  }

  const result = await compileSingleBundle({bundleName, variant, brandId})
  const includedFiles = result.includedFiles.map(relativeSassPath)
  if (watcher) {
    result.includedFiles.forEach(f => watcher.add(f))
  }
  const metaData = {
    variant,
    bundleName,
    brandId,
    includedFiles
  }
  if (brandId) {
    metaData.combinedChecksum = unbrandedCombinedChecksum
  } else {
    const md5s = includedFiles.map(getChecksum)
    metaData.combinedChecksum = checksum(result.css + md5s)
    metaData.includesNoVariables = !_.includes(includedFiles, relativeSassPath(PATHS.brandable_variables_defaults_scss))
    updateCache(metaData)
  }

  // This option is for deployers so they can create just the 2 manifest files
  // but not write any css files to the tarball.
  if (process.env.ONLY_GENERATE_MANIFESTS) return

  const filename = cssFilename(metaData)
  await (s3Bucket
    ? s3Bucket.uploadCSS(cdnObjectName(filename), result.css)
    : fs.outputFileAsync(filename, result.css)
  )
  return metaData
})

function cssFilename ({bundleName, variant, brandId, combinedChecksum, includesNoVariables}) {
  const {dir, name} = path.posix.parse(bundleName)
  const baseDir = includesNoVariables ? 'no_variables' : path.join(brandId || '', variant)
  return path.join(PATHS.output_dir, baseDir, dir, `${name}-${combinedChecksum}.css`)
}

function cdnObjectName (filename) {
  return filename.replace(PATHS.public_dir + '/', '')
}

function updateCache ({variant, bundleName, combinedChecksum, includedFiles, includesNoVariables}) {
  cache.bundles_with_deps.update(cacheKey(bundleName, variant), {combinedChecksum, includedFiles, includesNoVariables})
}

function onBundleDeleted (bundleName) {
  cache.bundles_with_deps.clearMatching(bundleName)
  cache.file_checksums.update(bundleName, undefined)
}

async function onFilesystemChange (eventType, filePath, details) {
  try {
    debug('onFilesystemChange', eventType, filePath, details.type)
    if (details.type !== 'file' || details.event === 'unknown') return

    if (filePath.match(PATHS.brandable_variables_json)) {
      debug(PATHS.brandable_variables_json, 'changed, saving to scss')
      return await writeDefaultBrandableVariablesScss()
    }
    filePath = relativeSassPath(filePath)

    if (eventType === 'deleted') {
      cache.file_checksums.update(filePath, undefined)
      if (!isSassPartial(filePath)) onBundleDeleted(filePath)
      unwatch(filePath)
      return
    }
    if (hasFileChanged(filePath)) {
      debug('changed contents', filePath)
      return await processChangedBundles(whatToCompileIfFileChanges(filePath))
    }
    debug('unchanged', filePath)
  } catch (e) {
    onError(e)
  }
}

function whatToCompileIfFileChanges (filename) {
  let toCompile = {}
  if (!isSassPartial(filename)) {
    const bundleName = filename
    for (const variant of VARIANTS) {
      _.set(toCompile, [bundleName, variant, 'compileSelf'], true)
      if (BRANDABLE_VARIANTS.has(variant)) {
        for (const brandId of getBrandIds()) {
          console.log(bundleName, variant, brandId)
          _.set(toCompile, [bundleName, variant, brandId], true)
        }
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

function hasFileChanged (relativePath) {
  const cached = cache.file_checksums.data[relativePath]
  const current = relativeFileChecksum(relativePath)
  cache.file_checksums.update(relativePath, current)
  return cached !== current
}

var watcher
const watched = new Set()
function watch (filename) {
  if (!watcher || watched.has(filename)) return
  watched.add(filename)
  watcher.add(filename)
}
function unwatch (filename) {
  if (!watcher || !watched.delete(filename)) return
  debug('unwatching', filename)
  watcher.unwatch(filename)
}
export function startWatcher () {
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
