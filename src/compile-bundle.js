const debug = require('debug')('canvas_css:compile-bundle')
import Promise from 'bluebird'
const existsAsync = Promise.promisify(require('fs').stat)
const sassRender = Promise.promisify(require('node-sass').render)
import path from 'path'
import _ from 'lodash'
import chalk from 'chalk'
import url from 'url'
import postcss from 'postcss'
import autoprefixer from 'autoprefixer'
import postcssUrl from 'postcss-url'
import {paths as PATHS} from "./config"
import {BRANDABLE_VARIANTS} from './variants'
import {fileChecksumSync} from './checksum'
import supportedBrowsers from './browser-support'
import cache from './cache'
import parse from './parse'
import {relativeSassPath, folderForBrandId} from './utils'

// If an image is in css source as url("/images/foo/bar.png"),
// Rails-asset-pipeline makes it available at the url: "/assets/foo/bar-{md5}.png"
function removeFirstDir(dir) {
  return dir.split('/').slice(2).join('/')
}
function sprocketsFormattedUrl(originalUrl, md5) {
  let parsedUrl = url.parse(originalUrl)

  const {dir, name, ext} = parse(parsedUrl.pathname)
  parsedUrl.pathname = `/assets/${removeFirstDir(dir)}/${name}-${md5}${ext}`
  return url.format(parsedUrl)
}

function warn() {
  console.error(chalk.yellow('canvas_css warning', ...arguments))
}

export default async function compileSingleBundle ({bundleName, variant, brandId}) {
  const sassFile = path.join(PATHS.sass_dir, bundleName)
  let includePaths = [PATHS.sass_dir, path.join(PATHS.sass_dir, 'variants', variant)]
  // pull in 'config/brand_variables.scss' if we should
  if (brandId) {
    if (!BRANDABLE_VARIANTS.has(variant)) throw new Error(`${variant} is not brandable`)
    const fileExists = await existsAsync(path.join(folderForBrandId(brandId), '_brand_variables.scss'))
    if (!fileExists) throw new Error(`_brand_variables.scss file not found for ${brandId}`)
    includePaths.unshift(folderForBrandId(brandId))
  }

  let urlsFoundInCss = new Set()
  function putMD5sInUrls(originalUrl) {
    const parsedUrl = url.parse(originalUrl)
    if (parsedUrl.host || parsedUrl.href.indexOf('//') === 0 || !parsedUrl.path) {
      warn(opts.sassFile, 'has an external url() to:', originalUrl, 'that\'s not a problem but normally our css only links to files in our repo')
      return originalUrl
    }
    const pathToFile = path.join(PATHS.public_dir, parsedUrl.pathname)
    const relativePath = relativeSassPath(pathToFile)
    let md5 = cache.file_checksums.data[relativePath]
    if (!md5) {
      md5 = fileChecksumSync(pathToFile)
      if (!md5) {
        warn(sassFile, variant, 'contains a url() to:', originalUrl, 'which doesn\'t exist on disk')
        return originalUrl
      }
      cache.file_checksums.update(relativePath, md5)
    }
    urlsFoundInCss.add(pathToFile)
    return sprocketsFormattedUrl(originalUrl, md5)
  }

  const startTime = new Date()
  const nodeSassResult = await sassRender({
    file: sassFile,
    includePaths: includePaths,
    // if you want compressed output (eg: in production), set the environment variable  CANVAS_SASS_STYLE=compressed
    outputStyle: process.env.CANVAS_SASS_STYLE || 'nested',
    sourceComments: process.env.CANVAS_SASS_STYLE !== 'compressed',
    sourceMap: false
  })

  const postcssResult = await postcss([
    autoprefixer({browsers: supportedBrowsers}),
    postcssUrl({url: putMD5sInUrls})
  ]).process(nodeSassResult.css, {from: sassFile})

  postcssResult.warnings().forEach(warn)
  console.warn(chalk.green('compiled', bundleName, variant, brandId || '', 'in'), new Date() - startTime, 'ms')

  return {
    css: postcssResult.css,
    includedFiles: nodeSassResult.stats.includedFiles.concat([...urlsFoundInCss])
  }
}