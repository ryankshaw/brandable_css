import Promise from 'bluebird'
const existsAsync = Promise.promisify(require('fs').stat)
const sassRender = Promise.promisify(require('node-sass').render)
const debug = require('debug')('canvas_css:compile-bundle')
import path from 'path'
import _ from 'lodash'
import chalk from 'chalk'
import url from 'url'
import postcss from 'postcss'
import autoprefixer from 'autoprefixer'
import postcssUrl from 'postcss-url'
import PATHS from './paths'
import {ofFileSync} from './checksum'
import supportedBrowsers from './browser-support'
import cache from './cache'
import {relativeSassPath} from './utils'

// Any logging from compileSingleBundle needs to go to stderr so we can use stdout to
// send css to rails controller when we compile a single bundle
function warn() {
  console.error(chalk.yellow('canvas_css warning', ...arguments))
}

export default async function compileSingleBundle ({bundleName, variant, brandVariablesFolder}) {
  const sassFile = path.join(PATHS.sass_dir, bundleName)
  let includePaths = [PATHS.sass_dir, path.join(PATHS.sass_dir, 'variants', variant)]
  // pull in 'config/brand_variables.scss' if we should
  if (brandVariablesFolder) {
    if (
      (variant === 'new_styles_normal_contrast' || variant === 'k12_normal_contrast') &&
      await existsAsync(path.join(brandVariablesFolder, '_brand_variables.scss'))
    ) {
      includePaths.unshift(brandVariablesFolder)
    } else {
      throw new Error('invalid brandVariablesFolder or you tried to include it in a legacy or high contrast bundle')
    }
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
      md5 = ofFileSync(pathToFile)
      if (!md5) {
        warn(sassFile, variant, 'contains a url() to:', originalUrl, 'which doesn\'t exist on disk')
        return originalUrl
      }
      cache.file_checksums.update(relativePath, md5)
    }
    urlsFoundInCss.add(pathToFile)

    const {dir, name, ext} = path.posix.parse(parsedUrl.pathname)
    parsedUrl.pathname = `/assets${dir}/${name}-${md5}${ext}`
    return url.format(parsedUrl)
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
  console.warn(chalk.green('compiled', variant, bundleName, 'in'), new Date() - startTime, 'ms')

  return {
    css: postcssResult.css,
    includedFiles: nodeSassResult.stats.includedFiles.concat([...urlsFoundInCss])
  }
}